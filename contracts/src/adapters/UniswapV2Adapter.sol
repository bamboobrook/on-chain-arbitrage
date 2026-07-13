// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IDexAdapter} from "../interfaces/IDexAdapter.sol";

interface IUniswapV2Pair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
}

/// @title UniswapV2Adapter
/// @notice Swaps via Uniswap-V2-style pairs (Uniswap V2, Sushi, Aerodrome volatile, ...).
///         Implements the constant-product getAmountOut math inline so we don't
///         need a separate router.
contract UniswapV2Adapter is IDexAdapter {
    using SafeERC20 for IERC20;

    error InvalidPairTokens(address tokenIn, address tokenOut);

    function swap(
        address pool,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external override returns (uint256 amountOut) {
        address token0 = IUniswapV2Pair(pool).token0();
        address token1 = IUniswapV2Pair(pool).token1();
        bool zeroForOne;
        if (tokenIn == token0 && tokenOut == token1) {
            zeroForOne = true;
        } else if (tokenIn == token1 && tokenOut == token0) {
            zeroForOne = false;
        } else {
            revert InvalidPairTokens(tokenIn, tokenOut);
        }

        (uint112 reserve0, uint112 reserve1,) = IUniswapV2Pair(pool).getReserves();
        (uint256 reserveIn, uint256 reserveOut) = zeroForOne ? (uint256(reserve0), uint256(reserve1)) : (uint256(reserve1), uint256(reserve0));
        require(reserveIn > 0 && reserveOut > 0, "V2Adapter: no liquidity");

        // Standard getAmountOut with 0.30% fee (3000 ppm). Real pairs vary;
        // for MVP we assume the dominant 30bps case. A fee-aware variant reads
        // the pair's fee tier; left as a TODO for production.
        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * 1000 + amountInWithFee;
        amountOut = numerator / denominator;
        require(amountOut >= minAmountOut, "V2Adapter: slippage");

        (uint256 amount0Out, uint256 amount1Out) = zeroForOne ? (uint256(0), amountOut) : (amountOut, uint256(0));
        uint256 balBefore = IERC20(tokenOut).balanceOf(recipient);
        IERC20(tokenIn).safeTransferFrom(msg.sender, pool, amountIn);
        IUniswapV2Pair(pool).swap(amount0Out, amount1Out, recipient, new bytes(0));
        uint256 actualOut = IERC20(tokenOut).balanceOf(recipient) - balBefore;
        require(actualOut >= minAmountOut, "V2Adapter: actual slippage");

        // Return actual output in case the pair/token behavior differs from the estimate.
        amountOut = actualOut;
    }
}
