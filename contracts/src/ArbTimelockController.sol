// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @title ArbTimelockController
/// @notice Parameter changes (fees, risk policy, controller allocations) go
///         through this timelock. The multisig / security council holds the
///         PROPOSER + EXECUTOR roles; emergency pause bypasses it via the
///         vault's GUARDIAN_ROLE (fast path).
contract ArbTimelockController is TimelockController {
    /// @param minDelay    Minimum delay for an operation to become executable.
    /// @param proposers   Addresses that can propose (usually multisig signers).
    /// @param executors   Addresses that can execute queued ops (multisig / anyone).
    /// @param admin       Default admin (renounced in production).
    constructor(uint256 minDelay, address[] memory proposers, address[] memory executors, address admin)
        TimelockController(minDelay, proposers, executors, admin)
    {}
}
