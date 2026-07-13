// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IDexAdapter} from "../interfaces/IDexAdapter.sol";

/// @title CurveStableSwapAdapter
/// @notice Swaps through classic Curve StableSwap pools using the pool address
///         as route identity. Coin indexes are discovered from `coins(i)` so
///         the narrow IDexAdapter interface does not need venue-specific bytes.
contract CurveStableSwapAdapter is IDexAdapter {
    using SafeERC20 for IERC20;

    uint256 private constant MAX_COINS = 8;
    bytes4 private constant COINS_UINT256_SELECTOR = bytes4(keccak256("coins(uint256)"));
    bytes4 private constant COINS_INT128_SELECTOR = bytes4(keccak256("coins(int128)"));
    bytes4 private constant GET_DY_SELECTOR = bytes4(keccak256("get_dy(int128,int128,uint256)"));
    bytes4 private constant EXCHANGE_SELECTOR = bytes4(keccak256("exchange(int128,int128,uint256,uint256)"));

    error InvalidCurvePoolTokens(address tokenIn, address tokenOut);
    error InvalidSwapAmount();
    error CurveQuoteFailed(address pool);
    error CurveSwapFailed(address pool, bytes reason);

    /// @inheritdoc IDexAdapter
    function swap(
        address pool,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external override returns (uint256 amountOut) {
        if (amountIn == 0) revert InvalidSwapAmount();

        (int128 i, bool foundIn) = _findCoinIndex(pool, tokenIn);
        (int128 j, bool foundOut) = _findCoinIndex(pool, tokenOut);
        if (!foundIn || !foundOut || i == j) {
            revert InvalidCurvePoolTokens(tokenIn, tokenOut);
        }

        uint256 quotedOut = _getDy(pool, i, j, amountIn);
        require(quotedOut >= minAmountOut, "CurveAdapter: quote slippage");

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).forceApprove(pool, amountIn);

        uint256 balBefore = IERC20(tokenOut).balanceOf(address(this));
        (bool ok, bytes memory reason) =
            pool.call(abi.encodeWithSelector(EXCHANGE_SELECTOR, i, j, amountIn, minAmountOut));
        IERC20(tokenIn).forceApprove(pool, 0);
        if (!ok) revert CurveSwapFailed(pool, reason);

        amountOut = IERC20(tokenOut).balanceOf(address(this)) - balBefore;
        require(amountOut >= minAmountOut, "CurveAdapter: actual slippage");
        IERC20(tokenOut).safeTransfer(recipient, amountOut);
    }

    function _getDy(address pool, int128 i, int128 j, uint256 amountIn) internal view returns (uint256) {
        (bool ok, bytes memory data) = pool.staticcall(abi.encodeWithSelector(GET_DY_SELECTOR, i, j, amountIn));
        if (!ok || data.length < 32) revert CurveQuoteFailed(pool);
        return abi.decode(data, (uint256));
    }

    function _findCoinIndex(address pool, address token) internal view returns (int128 coinIndex, bool found) {
        for (uint256 idx = 0; idx < MAX_COINS; idx++) {
            (address coin, bool ok) = _readCoin(pool, idx, COINS_UINT256_SELECTOR);
            if (ok && coin == token) return (int128(uint128(idx)), true);

            (coin, ok) = _readCoin(pool, idx, COINS_INT128_SELECTOR);
            if (ok && coin == token) return (int128(uint128(idx)), true);
        }
        return (0, false);
    }

    function _readCoin(address pool, uint256 idx, bytes4 selector) internal view returns (address coin, bool ok) {
        bytes memory callData = selector == COINS_INT128_SELECTOR
            ? abi.encodeWithSelector(selector, int128(uint128(idx)))
            : abi.encodeWithSelector(selector, idx);
        (ok, callData) = pool.staticcall(callData);
        if (!ok || callData.length < 32) return (address(0), false);
        coin = abi.decode(callData, (address));
    }
}
