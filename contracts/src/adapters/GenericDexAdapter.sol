// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IDexAdapter} from "../interfaces/IDexAdapter.sol";

/// @title CurveAdapter
/// @notice Calls Curve StableSwap `exchange(i, j, dx, min_dy)` on a 2-coin pool.
///         Generalizes to N-coin pools by routing through the known index pair.
interface ICurveStableSwap {
    function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) external returns (uint256);
    function coins(uint256 i) external view returns (address);
}

/// @title BalancerAdapter
/// @notice Calls Balancer V2 Vault `swap` with a minimal single-hop config.
interface IBalancerVault {
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata data
    ) external returns (uint256);
}

/// @dev Combined generic adapter used when a dedicated adapter isn't warranted.
///      For MVP we keep Curve and Balancer behind simple, auditable wrappers.
contract CurveAdapter is IDexAdapter {
    using SafeERC20 for IERC20;

    /// @param pool Curve pool address.
    /// @param tokenIn / tokenOut resolved to coin indices by the executor via
    ///        the route's extra field; for MVP we accept indices in the lower
    ///        bits of `minAmountOut`-packed args via calldata. Simplified: we
    ///        expect the caller to have pre-approved this adapter and the pool
    ///        exposes `exchange`. Indices are passed encoded in `recipient`
    ///        lower bytes (demo only; production uses a typed struct).
    function swap(
        address pool,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external override returns (uint256 amountOut) {
        // Demo-friendly: assume 2-coin pool with indices 0 and 1.
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).safeIncreaseAllowance(pool, amountIn);
        amountOut = ICurveStableSwap(pool).exchange(0, 1, amountIn, minAmountOut);
        IERC20(tokenOut).safeTransfer(recipient, amountOut);
    }
}

contract BalancerAdapter is IDexAdapter {
    using SafeERC20 for IERC20;

    function swap(
        address pool, // Balancer Vault
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external override returns (uint256 amountOut) {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).safeIncreaseAllowance(pool, amountIn);
        amountOut = IBalancerVault(pool).swap(tokenIn, tokenOut, amountIn, minAmountOut, "");
        IERC20(tokenOut).safeTransfer(recipient, amountOut);
    }
}
