// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IDexAdapter} from "./interfaces/IDexAdapter.sol";

interface ICometLike {
    function isLiquidatable(address account) external view returns (bool);
    function absorb(address absorber, address[] calldata accounts) external;
    function buyCollateral(address asset, uint256 minAmount, uint256 baseAmount, address recipient) external;
}

/// @title CompoundV3LiquidationExecutor
/// @notice Wallet-funded Compound III liquidation executor. A user approves the
///         base asset, the executor absorbs one liquidatable borrower, buys
///         discounted collateral from Comet, unwinds it through whitelisted DEX
///         adapters, and pays base asset principal plus profit back atomically.
contract CompoundV3LiquidationExecutor is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    struct Hop {
        address adapter;
        address pool;
        address tokenIn;
        address tokenOut;
        uint256 minAmountOut;
    }

    struct ExecutionRequest {
        ICometLike comet;
        IERC20 baseAsset;
        address borrower;
        address collateralAsset;
        uint256 baseAmount;
        uint256 minCollateralAmount;
        Hop[] unwindRoute;
        uint256 minProfitBase;
        uint256 deadline;
        address beneficiary;
    }

    mapping(address => bool) public whitelistedAdapters;

    event AdapterWhitelisted(address indexed adapter, bool allowed);
    event CompoundV3LiquidationSucceeded(
        address indexed user,
        address indexed borrower,
        address indexed beneficiary,
        address baseAsset,
        address collateralAsset,
        uint256 baseAmount,
        uint256 collateralBought,
        uint256 profit,
        uint256 payout
    );

    error PastDeadline();
    error InvalidAddress();
    error InvalidAmount();
    error AccountNotLiquidatable(address borrower);
    error RouteDoesNotStartWithCollateral(address firstToken, address collateralAsset);
    error RouteDoesNotCloseToBase(address lastToken, address baseAsset);
    error RouteTokenMismatch(uint256 hopIndex, address expectedTokenIn, address actualTokenIn);
    error AdapterNotWhitelisted(address adapter);
    error FeeOnTransferUnsupported(uint256 received, uint256 expected);
    error CollateralBelowMinimum(uint256 received, uint256 minimum);
    error InsufficientProfit(uint256 profit, uint256 floor);

    constructor(address admin) {
        if (admin == address(0)) revert InvalidAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, admin);
    }

    function whitelistAdapter(address adapter, bool allowed) external onlyRole(GUARDIAN_ROLE) {
        whitelistedAdapters[adapter] = allowed;
        emit AdapterWhitelisted(adapter, allowed);
    }

    function execute(ExecutionRequest calldata req) external nonReentrant returns (uint256 profit) {
        if (block.timestamp > req.deadline) revert PastDeadline();
        if (
            address(req.comet) == address(0) ||
            address(req.baseAsset) == address(0) ||
            req.borrower == address(0) ||
            req.collateralAsset == address(0)
        ) {
            revert InvalidAddress();
        }
        if (req.baseAmount == 0) revert InvalidAmount();
        if (!req.comet.isLiquidatable(req.borrower)) revert AccountNotLiquidatable(req.borrower);

        address baseAsset = address(req.baseAsset);
        if (req.unwindRoute.length == 0) {
            if (req.collateralAsset != baseAsset) {
                revert RouteDoesNotCloseToBase(req.collateralAsset, baseAsset);
            }
        } else {
            if (req.unwindRoute[0].tokenIn != req.collateralAsset) {
                revert RouteDoesNotStartWithCollateral(req.unwindRoute[0].tokenIn, req.collateralAsset);
            }
            address finalToken = req.unwindRoute[req.unwindRoute.length - 1].tokenOut;
            if (finalToken != baseAsset) revert RouteDoesNotCloseToBase(finalToken, baseAsset);
        }

        address[] memory accounts = new address[](1);
        accounts[0] = req.borrower;
        req.comet.absorb(address(this), accounts);

        uint256 baseBefore = req.baseAsset.balanceOf(address(this));
        req.baseAsset.safeTransferFrom(msg.sender, address(this), req.baseAmount);
        uint256 baseAfterPull = req.baseAsset.balanceOf(address(this));
        uint256 receivedBase = baseAfterPull - baseBefore;
        if (receivedBase != req.baseAmount) revert FeeOnTransferUnsupported(receivedBase, req.baseAmount);

        IERC20 collateral = IERC20(req.collateralAsset);
        uint256 collateralBefore = collateral.balanceOf(address(this));
        req.baseAsset.forceApprove(address(req.comet), req.baseAmount);
        req.comet.buyCollateral(req.collateralAsset, req.minCollateralAmount, req.baseAmount, address(this));
        req.baseAsset.forceApprove(address(req.comet), 0);
        uint256 collateralBought = collateral.balanceOf(address(this)) - collateralBefore;
        if (collateralBought < req.minCollateralAmount) {
            revert CollateralBelowMinimum(collateralBought, req.minCollateralAmount);
        }

        uint256 runningAmount = collateralBought;
        address expectedTokenIn = req.collateralAsset;
        for (uint256 i = 0; i < req.unwindRoute.length; i++) {
            Hop calldata hop = req.unwindRoute[i];
            if (hop.tokenIn != expectedTokenIn) {
                revert RouteTokenMismatch(i, expectedTokenIn, hop.tokenIn);
            }
            if (!whitelistedAdapters[hop.adapter]) revert AdapterNotWhitelisted(hop.adapter);

            IERC20(hop.tokenIn).forceApprove(hop.adapter, runningAmount);
            runningAmount = IDexAdapter(hop.adapter).swap(
                hop.pool,
                hop.tokenIn,
                hop.tokenOut,
                runningAmount,
                hop.minAmountOut,
                address(this)
            );
            IERC20(hop.tokenIn).forceApprove(hop.adapter, 0);
            expectedTokenIn = hop.tokenOut;
        }

        uint256 finalBase = req.baseAsset.balanceOf(address(this));
        uint256 minRequiredBase = baseBefore + req.baseAmount;
        if (finalBase < minRequiredBase) revert InsufficientProfit(0, req.minProfitBase);
        profit = finalBase - minRequiredBase;
        if (profit < req.minProfitBase) revert InsufficientProfit(profit, req.minProfitBase);

        uint256 payout = finalBase - baseBefore;
        address beneficiary = req.beneficiary == address(0) ? msg.sender : req.beneficiary;
        req.baseAsset.safeTransfer(beneficiary, payout);

        emit CompoundV3LiquidationSucceeded(
            msg.sender,
            req.borrower,
            beneficiary,
            baseAsset,
            req.collateralAsset,
            req.baseAmount,
            collateralBought,
            profit,
            payout
        );
    }
}
