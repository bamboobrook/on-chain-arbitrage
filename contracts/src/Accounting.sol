// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAccounting} from "./interfaces/IAccounting.sol";

/// @title Accounting
/// @notice Minimal on-chain ledger that emits indexer-friendly events for the
///         accounting-worker to parse into PnL, share-price and fee rows.
contract Accounting is IAccounting {
    struct VaultTotals {
        uint256 realizedProfit;
        uint256 fees;
        uint256 executions;
    }

    mapping(address => VaultTotals) public totals;

    event ProfitRecorded(address indexed vault, uint256 amount, uint256 fee, uint256 ts);
    event ExecutionRecorded(
        address indexed vault,
        address indexed executor,
        bytes32 indexed opportunityId,
        uint256 grossProfit,
        uint256 gasCost,
        uint256 bribeCost,
        uint256 netProfit,
        uint256 ts
    );

    function recordProfit(address vault, uint256 amount, uint256 fee) external override {
        totals[vault].realizedProfit += amount;
        totals[vault].fees += fee;
        emit ProfitRecorded(vault, amount, fee, block.timestamp);
    }

    function recordExecution(
        address vault,
        address executor,
        bytes32 opportunityId,
        uint256 grossProfit,
        uint256 gasCost,
        uint256 bribeCost,
        uint256 netProfit
    ) external override {
        totals[vault].executions += 1;
        emit ExecutionRecorded(
            vault, executor, opportunityId, grossProfit, gasCost, bribeCost, netProfit, block.timestamp
        );
    }
}
