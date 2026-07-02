// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal swap venue adapter. Each DEX family implements this so the
///         StrategyExecutor can route swaps without venue-specific logic.
interface IDexAdapter {
    /// @notice Swap `amountIn` of `tokenIn` for as much `tokenOut` as possible,
    ///         enforcing `minAmountOut`. Returns the amount received.
    function swap(
        address pool,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external returns (uint256 amountOut);
}
