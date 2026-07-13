// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IDexAdapter} from "../interfaces/IDexAdapter.sol";

interface IAerodromeRouter {
    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

/// @title AerodromeRouterAdapter
/// @notice IDexAdapter wrapper around Aerodrome Router single-hop swaps.
/// @dev Deploy one adapter per stable/factory setting. The `pool` argument is
///      intentionally ignored because Aerodrome router routes need more data
///      than IDexAdapter's single address can carry.
contract AerodromeRouterAdapter is IDexAdapter {
    using SafeERC20 for IERC20;

    address public immutable router;
    address public immutable factory;
    bool public immutable stable;

    constructor(address router_, address factory_, bool stable_) {
        require(router_ != address(0), "AerodromeAdapter: router");
        require(factory_ != address(0), "AerodromeAdapter: factory");
        router = router_;
        factory = factory_;
        stable = stable_;
    }

    function swap(
        address,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external override returns (uint256 amountOut) {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).forceApprove(router, amountIn);

        IAerodromeRouter.Route[] memory routes = new IAerodromeRouter.Route[](1);
        routes[0] = IAerodromeRouter.Route({
            from: tokenIn,
            to: tokenOut,
            stable: stable,
            factory: factory
        });

        uint256 balBefore = IERC20(tokenOut).balanceOf(recipient);
        IAerodromeRouter(router).swapExactTokensForTokens(
            amountIn,
            minAmountOut,
            routes,
            recipient,
            block.timestamp
        );
        IERC20(tokenIn).forceApprove(router, 0);

        amountOut = IERC20(tokenOut).balanceOf(recipient) - balBefore;
        require(amountOut >= minAmountOut, "AerodromeAdapter: slippage");
    }
}
