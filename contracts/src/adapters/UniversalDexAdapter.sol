// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IDexAdapter} from "../interfaces/IDexAdapter.sol";

/// @title UniswapV3Adapter
/// @notice Swaps via Uniswap V3 pools by calling pool.swap() directly. V3 swaps
///         are callback-based: the pool calls back `uniswapV3SwapCallback` and
///         we must pay the input token during the callback.
/// @dev    This adapter holds no state between swaps; the StrategyExecutor sets
///         `msg.sender`-context correctly. Multi-hop is out of scope for MVP.
interface IUniswapV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);

    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

contract UniswapV3Adapter is IDexAdapter {
    using SafeERC20 for IERC20;

    error InvalidPoolCallback(address caller, address expectedPool);
    error InvalidSwapTokens(address tokenIn, address tokenOut);
    error InvalidCallbackDeltas(int256 amount0Delta, int256 amount1Delta);
    error InvalidCallbackAmount(uint256 actual, uint256 expected);

    /// @inheritdoc IDexAdapter
    function swap(
        address pool,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external override returns (uint256 amountOut) {
        address token0 = IUniswapV3Pool(pool).token0();
        address token1 = IUniswapV3Pool(pool).token1();
        bool zeroForOne;
        if (tokenIn == token0 && tokenOut == token1) {
            zeroForOne = true;
        } else if (tokenIn == token1 && tokenOut == token0) {
            zeroForOne = false;
        } else {
            revert InvalidSwapTokens(tokenIn, tokenOut);
        }

        // Take input now; the callback pulls it from this adapter.
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        uint256 balBefore = IERC20(tokenOut).balanceOf(recipient);
        // positive amountSpecified = exact input swap
        IUniswapV3Pool(pool).swap(
            recipient,
            zeroForOne,
            int256(uint256(amountIn)),
            zeroForOne ? uint160(4295128740) : uint160(1461446703485210103287273052203988822378723970341),
            abi.encode(pool, tokenIn, amountIn)
        );
        uint256 balAfter = IERC20(tokenOut).balanceOf(recipient);
        amountOut = balAfter - balBefore;
        require(amountOut >= minAmountOut, "V3Adapter: slippage");
    }

    /// @notice V3 callback — the pool expects us to have paid `amountOwed`.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        (address pool, address tokenIn, uint256 expectedAmountOwed) = abi.decode(data, (address, address, uint256));
        if (msg.sender != pool) revert InvalidPoolCallback(msg.sender, pool);

        uint256 amountOwed;
        if (amount0Delta > 0 && amount1Delta <= 0) {
            amountOwed = uint256(amount0Delta);
        } else if (amount1Delta > 0 && amount0Delta <= 0) {
            amountOwed = uint256(amount1Delta);
        } else {
            revert InvalidCallbackDeltas(amount0Delta, amount1Delta);
        }
        if (amountOwed != expectedAmountOwed) {
            revert InvalidCallbackAmount(amountOwed, expectedAmountOwed);
        }

        IERC20(tokenIn).safeTransfer(msg.sender, amountOwed);
    }
}
