// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Central risk policy contract consulted before every execution.
interface IRiskManager {
    /// @dev Reverts if the proposed execution violates policy (loss caps,
    ///      exposure limits, blacklisted token/pool, paused state, etc.).
    function checkExecution(
        address vault,
        address executor,
        uint256 chainId,
        address[] calldata routeTokens,
        address[] calldata routePools,
        uint256 capital,
        uint256 minProfitAssets
    ) external view;

    /// @dev True if a token or pool is blacklisted.
    function isBlacklisted(address tokenOrPool) external view returns (bool);

    /// @dev True if the strategy/vault is currently paused by risk policy.
    function isPaused(bytes32 scopeId) external view returns (bool);
}
