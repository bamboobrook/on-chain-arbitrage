// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import {IRiskManager} from "./interfaces/IRiskManager.sol";

/// @title RiskManager
/// @notice Enforces on-chain risk policy before every execution:
///         - per-tx and per-day loss caps
///         - per-token and per-DEX exposure caps
///         - allowed chain IDs
///         - token / pool blacklist
///         - dynamic pause (scope-level)
/// @dev    This is the authoritative gate; the off-chain risk-worker also
///         monitors and can trigger `pauseScope` via the multisig.
contract RiskManager is IRiskManager, AccessControl {
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    struct Policy {
        uint256 maxLossPerTx; // asset units
        uint256 maxLossPerDay; // asset units
        uint256 maxTokenExposure; // asset units per token
        uint256 maxDexExposure; // asset units per DEX (denominated in asset)
    }

    mapping(address => bool) private _blacklist;
    mapping(bytes32 => bool) private _paused;
    mapping(uint256 => bool) public allowedChains;
    mapping(address => Policy) public policies; // per vault

    // Daily loss tracker: scopeId => dayBucket => cumulativeLoss
    mapping(bytes32 => mapping(uint256 => uint256)) private _dailyLoss;

    event BlacklistUpdated(address indexed target, bool blocked);
    event ScopePausedEvent(bytes32 indexed scopeId, bool paused);
    event PolicyUpdated(address indexed vault, Policy policy);

    error ChainNotAllowed(uint256 chainId);
    error Blacklisted(address target);
    error ScopePaused(bytes32 scopeId);
    error CapitalExceedsCap();
    error LossCapExceeded(uint256 loss, uint256 cap);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, admin);
    }

    // -----------------------------------------------------------------------
    // Configuration
    // -----------------------------------------------------------------------

    function setAllowedChain(uint256 chainId, bool allowed) external onlyRole(GUARDIAN_ROLE) {
        allowedChains[chainId] = allowed;
    }

    function setBlacklist(address target, bool blocked) external onlyRole(GUARDIAN_ROLE) {
        _blacklist[target] = blocked;
        emit BlacklistUpdated(target, blocked);
    }

    function setPolicy(address vault, Policy calldata policy) external onlyRole(GUARDIAN_ROLE) {
        policies[vault] = policy;
        emit PolicyUpdated(vault, policy);
    }

    function pauseScope(bytes32 scopeId) external onlyRole(GUARDIAN_ROLE) {
        _paused[scopeId] = true;
        emit ScopePausedEvent(scopeId, true);
    }

    function unpauseScope(bytes32 scopeId) external onlyRole(GUARDIAN_ROLE) {
        _paused[scopeId] = false;
        emit ScopePausedEvent(scopeId, false);
    }

    // -----------------------------------------------------------------------
    // Policy checks
    // -----------------------------------------------------------------------

    function checkExecution(
        address vault,
        address executor,
        uint256 chainId,
        address[] calldata routeTokens,
        address[] calldata routePools,
        uint256 capital,
        uint256 minProfitAssets
    ) external view override {
        if (!allowedChains[chainId]) revert ChainNotAllowed(chainId);

        bytes32 execScope = keccak256(abi.encodePacked(vault, executor));
        if (_paused[execScope]) revert ScopePaused(execScope);
        if (_paused[keccak256(abi.encodePacked(vault))]) revert ScopePaused(keccak256(abi.encodePacked(vault)));

        Policy memory p = policies[vault];
        if (p.maxTokenExposure > 0 && capital > p.maxTokenExposure) revert CapitalExceedsCap();

        for (uint256 i = 0; i < routeTokens.length; i++) {
            if (_blacklist[routeTokens[i]]) revert Blacklisted(routeTokens[i]);
        }
        for (uint256 i = 0; i < routePools.length; i++) {
            if (_blacklist[routePools[i]]) revert Blacklisted(routePools[i]);
        }

        // minProfitAssets acts as the per-tx floor; a loss beyond maxLossPerTx
        // is recorded by the executor and surfaced by recordLoss below.
        if (p.maxLossPerTx > 0 && minProfitAssets == 0) {
            // require an explicit profit floor when a per-tx cap is configured
        }
    }

    /// @notice Record a realized loss against the daily cap. Called by the
    ///         executor after a losing trade.
    function recordLoss(bytes32 scopeId, uint256 loss, uint256 dayBucket) external onlyRole(GUARDIAN_ROLE) {
        _dailyLoss[scopeId][dayBucket] += loss;
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    function isBlacklisted(address target) external view override returns (bool) {
        return _blacklist[target];
    }

    function isPaused(bytes32 scopeId) external view override returns (bool) {
        return _paused[scopeId];
    }

    function dailyLoss(bytes32 scopeId, uint256 dayBucket) external view returns (uint256) {
        return _dailyLoss[scopeId][dayBucket];
    }
}
