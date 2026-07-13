// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IDexAdapter} from "./interfaces/IDexAdapter.sol";

/// @title WalletAtomicArbitrageExecutor
/// @notice Wallet-first atomic arbitrage executor. A user approves the start
///         asset, calls execute(), and receives principal plus profit back in
///         the same asset. The whole route reverts unless it closes back into
///         the start asset and clears the requested profit floor.
contract WalletAtomicArbitrageExecutor is AccessControl, ReentrancyGuard {
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
        IERC20 asset;
        uint256 amountIn;
        Hop[] route;
        uint256 minProfitAssets;
        uint256 deadline;
        address beneficiary;
    }

    mapping(address => bool) public whitelistedAdapters;

    event AdapterWhitelisted(address indexed adapter, bool allowed);
    event WalletArbitrageSucceeded(
        address indexed user,
        address indexed beneficiary,
        address indexed asset,
        uint256 amountIn,
        uint256 profit,
        uint256 payout,
        uint256 hopCount
    );

    error PastDeadline();
    error InvalidAmount();
    error EmptyRoute();
    error RouteDoesNotStartWithAsset(address firstToken, address asset);
    error RouteDoesNotClose(address lastToken, address asset);
    error RouteTokenMismatch(uint256 hopIndex, address expectedTokenIn, address actualTokenIn);
    error AdapterNotWhitelisted(address adapter);
    error FeeOnTransferUnsupported(uint256 received, uint256 expected);
    error InsufficientProfit(uint256 profit, uint256 floor);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, admin);
    }

    function whitelistAdapter(address adapter, bool allowed) external onlyRole(GUARDIAN_ROLE) {
        whitelistedAdapters[adapter] = allowed;
        emit AdapterWhitelisted(adapter, allowed);
    }

    function execute(ExecutionRequest calldata req) external nonReentrant returns (uint256 profit) {
        if (block.timestamp > req.deadline) revert PastDeadline();
        if (req.amountIn == 0) revert InvalidAmount();
        if (req.route.length == 0) revert EmptyRoute();

        address asset = address(req.asset);
        if (req.route[0].tokenIn != asset) revert RouteDoesNotStartWithAsset(req.route[0].tokenIn, asset);
        address finalToken = req.route[req.route.length - 1].tokenOut;
        if (finalToken != asset) revert RouteDoesNotClose(finalToken, asset);

        uint256 assetBalanceBefore = req.asset.balanceOf(address(this));
        req.asset.safeTransferFrom(msg.sender, address(this), req.amountIn);
        uint256 assetBalanceAfterPull = req.asset.balanceOf(address(this));
        uint256 received = assetBalanceAfterPull - assetBalanceBefore;
        if (received != req.amountIn) revert FeeOnTransferUnsupported(received, req.amountIn);

        uint256 runningAmount = req.amountIn;
        address expectedTokenIn = asset;
        for (uint256 i = 0; i < req.route.length; i++) {
            Hop calldata hop = req.route[i];
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

        uint256 finalBalance = req.asset.balanceOf(address(this));
        uint256 minRequiredBalance = assetBalanceBefore + req.amountIn;
        if (finalBalance < minRequiredBalance) revert InsufficientProfit(0, req.minProfitAssets);
        profit = finalBalance - minRequiredBalance;
        if (profit < req.minProfitAssets) revert InsufficientProfit(profit, req.minProfitAssets);

        uint256 payout = finalBalance - assetBalanceBefore;
        address beneficiary = req.beneficiary == address(0) ? msg.sender : req.beneficiary;
        req.asset.safeTransfer(beneficiary, payout);
        emit WalletArbitrageSucceeded(
            msg.sender,
            beneficiary,
            asset,
            req.amountIn,
            profit,
            payout,
            req.route.length
        );
    }
}
