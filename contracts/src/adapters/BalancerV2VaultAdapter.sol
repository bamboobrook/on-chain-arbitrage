// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IDexAdapter} from "../interfaces/IDexAdapter.sol";

interface IAsset {}

interface IBalancerV2Pool {
    function getPoolId() external view returns (bytes32);
}

interface IBalancerV2Vault {
    enum SwapKind {
        GIVEN_IN,
        GIVEN_OUT
    }

    struct SingleSwap {
        bytes32 poolId;
        SwapKind kind;
        IAsset assetIn;
        IAsset assetOut;
        uint256 amount;
        bytes userData;
    }

    struct FundManagement {
        address sender;
        bool fromInternalBalance;
        address payable recipient;
        bool toInternalBalance;
    }

    function swap(SingleSwap calldata singleSwap, FundManagement calldata funds, uint256 limit, uint256 deadline)
        external
        payable
        returns (uint256 amountCalculated);
}

/// @title BalancerV2VaultAdapter
/// @notice Swaps through Balancer V2 pools by deriving the poolId from the pool
///         contract and settling through the canonical Vault.
contract BalancerV2VaultAdapter is IDexAdapter {
    using SafeERC20 for IERC20;

    IBalancerV2Vault public immutable vault;

    error InvalidBalancerVault(address vault);
    error InvalidBalancerSwapTokens(address tokenIn, address tokenOut);
    error InvalidSwapAmount();

    constructor(address vault_) {
        if (vault_ == address(0)) revert InvalidBalancerVault(vault_);
        vault = IBalancerV2Vault(vault_);
    }

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
        if (tokenIn == tokenOut) revert InvalidBalancerSwapTokens(tokenIn, tokenOut);

        bytes32 poolId = IBalancerV2Pool(pool).getPoolId();
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).forceApprove(address(vault), amountIn);

        uint256 balBefore = IERC20(tokenOut).balanceOf(address(this));
        vault.swap(
            IBalancerV2Vault.SingleSwap({
                poolId: poolId,
                kind: IBalancerV2Vault.SwapKind.GIVEN_IN,
                assetIn: IAsset(tokenIn),
                assetOut: IAsset(tokenOut),
                amount: amountIn,
                userData: new bytes(0)
            }),
            IBalancerV2Vault.FundManagement({
                sender: address(this),
                fromInternalBalance: false,
                recipient: payable(address(this)),
                toInternalBalance: false
            }),
            minAmountOut,
            block.timestamp
        );
        IERC20(tokenIn).forceApprove(address(vault), 0);

        amountOut = IERC20(tokenOut).balanceOf(address(this)) - balBefore;
        require(amountOut >= minAmountOut, "BalancerAdapter: actual slippage");
        IERC20(tokenOut).safeTransfer(recipient, amountOut);
    }
}
