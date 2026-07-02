// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Optional on-chain accounting sink for indexer-friendly events.
interface IAccounting {
    /// @notice Record realized profit for a vault.
    /// @param vault The vault address.
    /// @param amount Net profit in asset units.
    /// @param fee Performance fee taken (asset units).
    function recordProfit(address vault, uint256 amount, uint256 fee) external;

    /// @notice Record an executed trade.
    function recordExecution(
        address vault,
        address executor,
        bytes32 opportunityId,
        uint256 grossProfit,
        uint256 gasCost,
        uint256 bribeCost,
        uint256 netProfit
    ) external;
}
