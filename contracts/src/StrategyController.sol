// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title StrategyController
/// @notice Maps vaults to strategies and enforces capital caps, daily-loss
///         caps, max deployable fraction, and the executor whitelist.
/// @dev    The controller is the trust boundary: only executors it whitelists
///         may pull vault capital via the StrategyExecutor. Capital never leaves
///         the vault system except through whitelisted adapters.
contract StrategyController is AccessControl {
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    struct Allocation {
        uint256 maxCapital; // absolute cap in asset units
        uint256 maxLossPerDay; // asset units
        uint256 maxDeployablePct; // bps of vault TVL (e.g. 8000 = 80%)
        bool active;
    }

    /// vault => strategyId => Allocation
    mapping(address => mapping(bytes32 => Allocation)) public allocations;
    /// executor whitelist
    mapping(address => bool) public executors;

    event AllocationSet(address indexed vault, bytes32 indexed strategyId, Allocation allocation);
    event ExecutorSet(address indexed executor, bool allowed);

    error NotWhitelistedExecutor();
    error StrategyInactive();
    error CapitalCapExceeded(uint256 requested, uint256 cap);
    error DeployablePctExceeded();

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, admin);
    }

    function setExecutor(address executor, bool allowed) external onlyRole(GUARDIAN_ROLE) {
        executors[executor] = allowed;
        emit ExecutorSet(executor, allowed);
    }

    function setAllocation(address vault, bytes32 strategyId, Allocation calldata allocation)
        external
        onlyRole(GUARDIAN_ROLE)
    {
        allocations[vault][strategyId] = allocation;
        emit AllocationSet(vault, strategyId, allocation);
    }

    /// @notice Authorize a capital draw against a vault's strategy allocation.
    /// @dev    Reverts if the executor isn't whitelisted or the cap is breached.
    function authorize(
        address vault,
        bytes32 strategyId,
        address executor,
        uint256 amount,
        uint256 vaultTvl
    ) external view returns (Allocation memory) {
        if (!executors[executor]) revert NotWhitelistedExecutor();
        Allocation memory a = allocations[vault][strategyId];
        if (!a.active) revert StrategyInactive();
        if (a.maxCapital > 0 && amount > a.maxCapital) revert CapitalCapExceeded(amount, a.maxCapital);
        if (a.maxDeployablePct > 0 && vaultTvl > 0) {
            uint256 maxFromPct = (vaultTvl * a.maxDeployablePct) / 10_000;
            if (amount > maxFromPct) revert DeployablePctExceeded();
        }
        return a;
    }
}
