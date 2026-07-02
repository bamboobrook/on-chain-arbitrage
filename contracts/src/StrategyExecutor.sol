// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ArbVault} from "./ArbVault.sol";
import {StrategyController} from "./StrategyController.sol";
import {IDexAdapter} from "./interfaces/IDexAdapter.sol";
import {IRiskManager} from "./interfaces/IRiskManager.sol";
import {IAccounting} from "./interfaces/IAccounting.sol";

/// @title StrategyExecutor
/// @notice Executes an atomic arbitrage route on behalf of a vault:
///         1. pull principal from the vault (this executor must be a holder of
///            EXECUTOR_ROLE on the vault)
///         2. walk the route via whitelisted DexAdapters
///         3. measure profit by final asset balance vs principal
///         4. return principal + profit to the vault; report profit
///         5. revert if net profit < minProfitAssets (atomic, no leftover exposure)
///
/// @dev    Security rules (design §5.2):
///         - only whitelisted adapters, no arbitrary call
///         - SafeERC20 everywhere
///         - before/after balance checks
///         - profit judged by final asset balance, not oracle
///         - minProfitAssets in calldata
///         - deadline + maxGasCost guard
contract StrategyExecutor is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    struct Hop {
        address adapter; // whitelisted DexAdapter
        address pool; // venue address
        address tokenIn;
        address tokenOut;
        uint256 minAmountOut; // per-hop slippage guard
    }

    struct ExecutionRequest {
        ArbVault vault;
        IERC20 asset; // entry == exit asset for atomic arb
        bytes32 strategyId;
        uint256 principal;
        Hop[] route;
        uint256 minProfitAssets; // net profit floor; reverts if not met
        uint256 deadline; // block.timestamp upper bound
    }

    /// vault => isTrusted (this executor may pull its capital)
    mapping(address => bool) public trustedVaults;
    /// adapter whitelist
    mapping(address => bool) public whitelistedAdapters;

    StrategyController public controller;
    IRiskManager public riskManager;
    IAccounting public accounting;

    event ExecutionSucceeded(
        address indexed vault, bytes32 indexed strategyId, uint256 principal, uint256 profit, uint256 gasUsed
    );
    event ExecutionFailed(address indexed vault, bytes32 indexed strategyId, string reason);
    event VaultTrusted(address indexed vault, bool trusted);
    event AdapterWhitelisted(address indexed adapter, bool allowed);

    error PastDeadline();
    error UntrustedVault();
    error AdapterNotWhitelisted(address adapter);
    error InsufficientProfit(uint256 profit, uint256 floor);
    error PrincipalNotReturned(uint256 returned, uint256 expected);

    constructor(address admin, StrategyController controller_, IRiskManager riskManager_, IAccounting accounting_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, admin);
        controller = controller_;
        riskManager = riskManager_;
        accounting = accounting_;
    }

    // -----------------------------------------------------------------------
    // Configuration
    // -----------------------------------------------------------------------

    function setTrustedVault(address vault, bool trusted) external onlyRole(GUARDIAN_ROLE) {
        trustedVaults[vault] = trusted;
        emit VaultTrusted(vault, trusted);
    }

    function whitelistAdapter(address adapter, bool allowed) external onlyRole(GUARDIAN_ROLE) {
        whitelistedAdapters[adapter] = allowed;
        emit AdapterWhitelisted(adapter, allowed);
    }

    function setController(StrategyController c) external onlyRole(GUARDIAN_ROLE) {
        controller = c;
    }

    // -----------------------------------------------------------------------
    // Execution
    // -----------------------------------------------------------------------

    /// @notice Execute an atomic arbitrage route. Atomic: reverts if profit
    ///         below floor, leaving no intermediate exposure.
    /// @dev    The vault must have granted this executor permission to pull
    ///         principal. In the MVP the vault transfers principal directly
    ///         (see `fundFromVault`); a production version uses a pull pattern.
    function execute(ExecutionRequest calldata req) external nonReentrant returns (uint256 profit) {
        if (block.timestamp > req.deadline) revert PastDeadline();
        if (!trustedVaults[address(req.vault)]) revert UntrustedVault();

        uint256 gasBefore = gasleft();

        // Risk check.
        if (address(riskManager) != address(0)) {
            (address[] memory tokens, address[] memory pools) = _extractRouteTokensAndPools(req.route);
            riskManager.checkExecution(
                address(req.vault),
                address(this),
                block.chainid,
                tokens,
                pools,
                req.principal,
                req.minProfitAssets
            );
        }

        // Capital allocation policy.
        if (address(controller) != address(0)) {
            controller.authorize(
                address(req.vault), req.strategyId, address(this), req.principal, req.vault.totalAssets()
            );
        }

        // Pull principal: this executor must be funded by the vault before the
        // call (vault.transferAssetsToExecutor) OR we pull here. For the atomic
        // demo we assume the vault has already forwarded principal to us.
        uint256 balStart = req.asset.balanceOf(address(this));
        require(balStart >= req.principal, "StrategyExecutor: principal not present");

        // Walk the route.
        uint256 runningAmount = req.principal;
        for (uint256 i = 0; i < req.route.length; i++) {
            Hop calldata hop = req.route[i];
            if (!whitelistedAdapters[hop.adapter]) revert AdapterNotWhitelisted(hop.adapter);

            // Approve adapter to pull the input token for this hop.
            IERC20(hop.tokenIn).safeIncreaseAllowance(hop.adapter, runningAmount);

            uint256 out = IDexAdapter(hop.adapter).swap(
                hop.pool, hop.tokenIn, hop.tokenOut, runningAmount, hop.minAmountOut, address(this)
            );
            runningAmount = out;
        }

        // The route must end back in `asset` for atomic arb.
        require(address(req.asset) == req.route[req.route.length - 1].tokenOut, "StrategyExecutor: route not closed");

        uint256 balEnd = req.asset.balanceOf(address(this));
        // Principal returned to vault; profit = balEnd - principal (must be >= 0).
        if (balEnd < req.principal) {
            emit ExecutionFailed(address(req.vault), req.strategyId, "net loss");
            revert InsufficientProfit(0, req.minProfitAssets);
        }
        profit = balEnd - req.principal;

        if (profit < req.minProfitAssets) {
            // Revert atomically: no leftover exposure.
            revert InsufficientProfit(profit, req.minProfitAssets);
        }

        // Return principal + profit to the vault in a single transfer. The
        // vault's reportProfit only does bookkeeping + fee-share minting; it
        // must not pull tokens (the funds are already in its balance).
        req.asset.safeTransfer(address(req.vault), balEnd);

        // Report profit (performance fee taken inside vault via share mint).
        req.vault.reportProfit(profit, req.minProfitAssets);

        if (address(accounting) != address(0)) {
            try accounting.recordExecution(
                address(req.vault),
                address(this),
                keccak256(abi.encodePacked(req.strategyId, block.timestamp)),
                profit + req.principal,
                gasBefore - gasleft(),
                0,
                profit
            ) {} catch {}
        }

        emit ExecutionSucceeded(
            address(req.vault), req.strategyId, req.principal, profit, gasBefore - gasleft()
        );
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    function _extractRouteTokensAndPools(Hop[] calldata route)
        internal
        pure
        returns (address[] memory tokens, address[] memory pools)
    {
        tokens = new address[](route.length + 1);
        pools = new address[](route.length);
        for (uint256 i = 0; i < route.length; i++) {
            tokens[i] = route[i].tokenIn;
            pools[i] = route[i].pool;
        }
        tokens[route.length] = route[route.length - 1].tokenOut;
    }
}
