// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC4626, ERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IAccounting} from "./interfaces/IAccounting.sol";
import {IRiskManager} from "./interfaces/IRiskManager.sol";

/// @title ArbVault
/// @notice Single-asset ERC-4626 vault that holds user funds and routes capital
///         to whitelisted arbitrage strategies. Profit accrues to share price.
/// @dev    Non-custodial: users always hold shares and can redeem (subject to
///         the vault pause / withdrawal window). Pre-audit, research build.
contract ArbVault is ERC4626, ERC20Permit, Pausable, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Role that may pause/unpause and configure fees.
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    /// @dev Role that may report realized profit (the StrategyExecutor).
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");

    /// @notice Performance fee in basis points (e.g. 1000 = 10%). Charged on
    ///         profit realized by executors; stays in the vault, accruing to
    ///         all shareholders.
    uint256 public performanceFeeBps;
    /// @notice Address that receives the performance-fee share (treasury).
    address public feeRecipient;

    /// @notice Cumulative realized profit accounted since deployment (asset units).
    uint256 public totalRealizedProfit;

    IRiskManager public riskManager;
    IAccounting public accounting;

    /// @notice Emitted when an executor reports profit on behalf of the vault.
    event ProfitReported(address indexed executor, uint256 amount, uint256 feeTaken);
    /// @notice Emitted when performance fee changes (timelocked off-chain).
    event PerformanceFeeUpdated(uint256 oldBps, uint256 newBps);

    error ZeroAddress();
    error FeeTooHigh();
    error InsufficientProfit(uint256 have, uint256 want);
    error UnauthorizedStrategy();

    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        uint256 performanceFeeBps_,
        address feeRecipient_,
        address admin_,
        IRiskManager riskManager_,
        IAccounting accounting_
    ) ERC4626(asset_) ERC20(name_, symbol_) ERC20Permit(name_) {
        if (feeRecipient_ == address(0) || admin_ == address(0)) revert ZeroAddress();
        if (performanceFeeBps_ > 5000) revert FeeTooHigh(); // cap 50%
        performanceFeeBps = performanceFeeBps_;
        feeRecipient = feeRecipient_;
        riskManager = riskManager_;
        accounting = accounting_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(GUARDIAN_ROLE, admin_);
    }

    // -----------------------------------------------------------------------
    // Pausable deposit/withdraw (redeem stays open unless fully paused).
    // -----------------------------------------------------------------------

    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(GUARDIAN_ROLE) {
        _unpause();
    }

    function deposit(uint256 assets, address receiver)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner)
        public
        override
        nonReentrant
        returns (uint256)
    {
        return super.withdraw(assets, receiver, owner);
    }

    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        nonReentrant
        returns (uint256)
    {
        return super.redeem(shares, receiver, owner);
    }

    // -----------------------------------------------------------------------
    // Profit accounting — called by the StrategyExecutor after a winning trade.
    // -----------------------------------------------------------------------

    /// @notice Report net profit credited back to the vault. The principal must
    ///         already have been returned; `amount` is pure profit in asset units.
    ///         Performance fee is taken by minting feeRecipient shares, so the
    ///         fee accrues as vault shares (perf-fee-on-profit model).
    /// @dev    Reverts if profit is below the floor to discourage low-value txs.
    function reportProfit(uint256 amount, uint256 minProfitAssets) external onlyRole(EXECUTOR_ROLE) {
        if (amount < minProfitAssets) {
            revert InsufficientProfit(amount, minProfitAssets);
        }

        uint256 fee = (amount * performanceFeeBps) / 10_000;
        // Verify the vault actually holds the assets (sanity + anti-over-report).
        uint256 balance = IERC20(asset()).balanceOf(address(this));
        require(balance >= amount, "ArbVault: profit not present");

        totalRealizedProfit += amount;

        // Mint fee as shares to the fee recipient (dilutes existing holders by
        // the fee fraction — standard performance-fee mechanic).
        if (fee > 0) {
            // shares = fee * totalSupply / (totalAssets + fee)  ...approx via deposit
            uint256 sharesToMint = _convertToShares(fee, Math.Rounding.Floor);
            if (sharesToMint > 0) {
                _mint(feeRecipient, sharesToMint);
            }
        }

        if (address(accounting) != address(0)) {
            try accounting.recordProfit(address(this), amount, fee) {} catch {}
        }

        emit ProfitReported(msg.sender, amount, fee);
    }

    // -----------------------------------------------------------------------
    // Admin
    // -----------------------------------------------------------------------

    function setPerformanceFee(uint256 newBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newBps > 5000) revert FeeTooHigh();
        emit PerformanceFeeUpdated(performanceFeeBps, newBps);
        performanceFeeBps = newBps;
    }

    function setFeeRecipient(address recipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (recipient == address(0)) revert ZeroAddress();
        feeRecipient = recipient;
    }

    function setRiskManager(IRiskManager rm) external onlyRole(DEFAULT_ADMIN_ROLE) {
        riskManager = rm;
    }

    function setAccounting(IAccounting acc) external onlyRole(DEFAULT_ADMIN_ROLE) {
        accounting = acc;
    }

    /// @notice Total assets under management (vault balance of the asset token).
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    /// @dev Resolve the diamond-inheritance `decimals` declared in both
    ///      ERC4626 (via ERC20) and ERC20Permit (via ERC20). We follow the
    ///      ERC4626 resolution: inherit the underlying asset's decimals.
    function decimals() public view override(ERC4626, ERC20) returns (uint8) {
        return ERC4626.decimals();
    }
}
