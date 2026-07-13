// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IDexAdapter} from "./interfaces/IDexAdapter.sol";

interface IMorphoBlueLike {
    struct MarketParams {
        address loanToken;
        address collateralToken;
        address oracle;
        address irm;
        uint256 lltv;
    }

    function position(bytes32 id, address user)
        external
        view
        returns (uint256 supplyShares, uint256 borrowShares, uint256 collateral);

    function liquidate(
        MarketParams calldata marketParams,
        address borrower,
        uint256 seizedAssets,
        uint256 repaidShares,
        bytes calldata data
    ) external returns (uint256 assetsSeized, uint256 assetsRepaid);
}

/// @title MorphoBlueLiquidationExecutor
/// @notice Wallet-funded Morpho Blue liquidation executor. A user approves the
///         loan asset, this contract repays borrower shares, receives collateral,
///         unwinds it through whitelisted DEX adapters, and pays principal plus
///         profit back atomically.
contract MorphoBlueLiquidationExecutor is AccessControl, ReentrancyGuard {
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
        IMorphoBlueLike morpho;
        IMorphoBlueLike.MarketParams marketParams;
        address borrower;
        uint256 seizedAssets;
        uint256 repaidShares;
        uint256 maxRepayAssets;
        uint256 minCollateralSeized;
        Hop[] unwindRoute;
        uint256 minProfitLoan;
        uint256 deadline;
        address beneficiary;
    }

    mapping(address => bool) public whitelistedAdapters;

    event AdapterWhitelisted(address indexed adapter, bool allowed);
    event MorphoBlueLiquidationSucceeded(
        address indexed user,
        address indexed borrower,
        address indexed beneficiary,
        address loanAsset,
        address collateralAsset,
        uint256 assetsRepaid,
        uint256 assetsSeized,
        uint256 maxRepayAssets,
        uint256 profit,
        uint256 payout
    );

    error PastDeadline();
    error InvalidAddress();
    error InvalidAmount();
    error PositionNotBorrowing(address borrower);
    error InconsistentLiquidationInput(uint256 seizedAssets, uint256 repaidShares);
    error SeizedAssetsExceedCollateral(uint256 requested, uint256 available);
    error RepaySharesExceedBorrowShares(uint256 requested, uint256 available);
    error RouteDoesNotStartWithCollateral(address firstToken, address collateralAsset);
    error RouteDoesNotCloseToLoan(address lastToken, address loanAsset);
    error RouteTokenMismatch(uint256 hopIndex, address expectedTokenIn, address actualTokenIn);
    error AdapterNotWhitelisted(address adapter);
    error FeeOnTransferUnsupported(uint256 received, uint256 expected);
    error CollateralBelowMinimum(uint256 received, uint256 minimum);
    error RepayExceededMaximum(uint256 observed, uint256 maximum);
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
        _validateRequest(req);

        address loanAsset = req.marketParams.loanToken;
        address collateralAsset = req.marketParams.collateralToken;
        _validateRoute(req, loanAsset, collateralAsset);

        bytes32 marketId = keccak256(abi.encode(req.marketParams));
        (, uint256 borrowShares, uint256 collateral) = req.morpho.position(marketId, req.borrower);
        if (borrowShares == 0 || collateral == 0) revert PositionNotBorrowing(req.borrower);
        if (req.seizedAssets > collateral) {
            revert SeizedAssetsExceedCollateral(req.seizedAssets, collateral);
        }
        if (req.repaidShares > 0 && req.repaidShares > borrowShares) {
            revert RepaySharesExceedBorrowShares(req.repaidShares, borrowShares);
        }

        IERC20 loan = IERC20(loanAsset);
        IERC20 collateralToken = IERC20(collateralAsset);
        uint256 loanBefore = loan.balanceOf(address(this));
        loan.safeTransferFrom(msg.sender, address(this), req.maxRepayAssets);
        uint256 loanAfterPull = loan.balanceOf(address(this));
        uint256 receivedLoan = loanAfterPull - loanBefore;
        if (receivedLoan != req.maxRepayAssets) {
            revert FeeOnTransferUnsupported(receivedLoan, req.maxRepayAssets);
        }

        uint256 collateralBefore = collateralToken.balanceOf(address(this));
        loan.forceApprove(address(req.morpho), req.maxRepayAssets);
        (uint256 assetsSeized, uint256 assetsRepaid) =
            req.morpho.liquidate(req.marketParams, req.borrower, req.seizedAssets, req.repaidShares, "");
        loan.forceApprove(address(req.morpho), 0);
        if (assetsRepaid > req.maxRepayAssets) revert RepayExceededMaximum(assetsRepaid, req.maxRepayAssets);

        uint256 collateralReceived = collateralToken.balanceOf(address(this)) - collateralBefore;
        if (collateralReceived < req.minCollateralSeized || collateralReceived < assetsSeized) {
            revert CollateralBelowMinimum(collateralReceived, req.minCollateralSeized);
        }

        uint256 runningAmount = collateralReceived;
        address expectedTokenIn = collateralAsset;
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

        uint256 finalLoan = loan.balanceOf(address(this));
        uint256 minRequiredLoan = loanBefore + req.maxRepayAssets;
        if (finalLoan < minRequiredLoan) revert InsufficientProfit(0, req.minProfitLoan);
        profit = finalLoan - minRequiredLoan;
        if (profit < req.minProfitLoan) revert InsufficientProfit(profit, req.minProfitLoan);

        uint256 payout = finalLoan - loanBefore;
        address beneficiary = req.beneficiary == address(0) ? msg.sender : req.beneficiary;
        loan.safeTransfer(beneficiary, payout);

        emit MorphoBlueLiquidationSucceeded(
            msg.sender,
            req.borrower,
            beneficiary,
            loanAsset,
            collateralAsset,
            assetsRepaid,
            assetsSeized,
            req.maxRepayAssets,
            profit,
            payout
        );
    }

    function _validateRequest(ExecutionRequest calldata req) internal pure {
        if (
            address(req.morpho) == address(0) ||
            req.marketParams.loanToken == address(0) ||
            req.marketParams.collateralToken == address(0) ||
            req.marketParams.oracle == address(0) ||
            req.marketParams.irm == address(0) ||
            req.borrower == address(0)
        ) {
            revert InvalidAddress();
        }
        bool seizedMode = req.seizedAssets > 0 && req.repaidShares == 0;
        bool repaidSharesMode = req.seizedAssets == 0 && req.repaidShares > 0;
        if (!seizedMode && !repaidSharesMode) {
            revert InconsistentLiquidationInput(req.seizedAssets, req.repaidShares);
        }
        if (req.maxRepayAssets == 0 || req.marketParams.lltv == 0) {
            revert InvalidAmount();
        }
    }

    function _validateRoute(
        ExecutionRequest calldata req,
        address loanAsset,
        address collateralAsset
    ) internal pure {
        if (req.unwindRoute.length == 0) {
            if (collateralAsset != loanAsset) revert RouteDoesNotCloseToLoan(collateralAsset, loanAsset);
        } else {
            if (req.unwindRoute[0].tokenIn != collateralAsset) {
                revert RouteDoesNotStartWithCollateral(req.unwindRoute[0].tokenIn, collateralAsset);
            }
            address finalToken = req.unwindRoute[req.unwindRoute.length - 1].tokenOut;
            if (finalToken != loanAsset) revert RouteDoesNotCloseToLoan(finalToken, loanAsset);
        }
    }
}
