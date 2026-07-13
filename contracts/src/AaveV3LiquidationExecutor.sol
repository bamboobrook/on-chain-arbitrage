// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAaveV3PoolLike {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;

    function liquidationCall(
        address collateralAsset,
        address debtAsset,
        address user,
        uint256 debtToCover,
        bool receiveAToken
    ) external;
}

interface IAaveV3FlashLoanSimpleReceiver {
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

/// @title AaveV3LiquidationExecutor
/// @notice Minimal Aave V3 flash-loan liquidation executor used by the live
///         gate and fork simulator. It is intentionally narrow:
///         1. borrow the debt asset with flashLoanSimple
///         2. call Aave liquidationCall for a single borrower/pair
///         3. optionally unwind seized collateral through a whitelisted target
///         4. approve flash-loan repayment
///         5. revert unless debt-asset balance covers repayment + min profit
contract AaveV3LiquidationExecutor is
    AccessControl,
    ReentrancyGuard,
    IAaveV3FlashLoanSimpleReceiver
{
    using SafeERC20 for IERC20;

    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    IAaveV3PoolLike public immutable aavePool;

    mapping(address => bool) public whitelistedUnwindTargets;

    struct LiquidationParams {
        address collateralAsset;
        address borrower;
        uint256 debtToCover;
        bool receiveAToken;
        address unwindTarget;
        bytes unwindCalldata;
        uint256 minDebtAssetOut;
        uint256 minProfit;
        address beneficiary;
    }

    event UnwindTargetWhitelisted(address indexed target, bool allowed);
    event LiquidationExecuted(
        address indexed borrower,
        address indexed debtAsset,
        address indexed collateralAsset,
        uint256 debtToCover,
        uint256 premium,
        uint256 profit,
        address beneficiary
    );

    error InvalidPool();
    error InvalidAddress();
    error InvalidFlashLoanCallback();
    error DebtAmountMismatch(uint256 expected, uint256 actual);
    error ReceiveATokenUnsupported();
    error MissingUnwindTarget();
    error UnwindTargetNotWhitelisted(address target);
    error UnwindCallFailed(bytes reason);
    error InsufficientDebtAssetOut(uint256 observed, uint256 required);
    error InsufficientProfit(uint256 observed, uint256 required);

    constructor(address aavePool_, address admin) {
        if (aavePool_ == address(0) || admin == address(0)) revert InvalidAddress();
        aavePool = IAaveV3PoolLike(aavePool_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, admin);
    }

    function setUnwindTarget(address target, bool allowed) external onlyRole(GUARDIAN_ROLE) {
        if (target == address(0)) revert InvalidAddress();
        whitelistedUnwindTargets[target] = allowed;
        emit UnwindTargetWhitelisted(target, allowed);
    }

    function executeLiquidation(
        address debtAsset,
        uint256 debtToCover,
        LiquidationParams calldata params
    ) external nonReentrant {
        _validateRequest(debtAsset, debtToCover, params);
        bytes memory callbackParams = abi.encode(msg.sender, debtAsset, params);
        aavePool.flashLoanSimple(address(this), debtAsset, debtToCover, callbackParams, 0);
    }

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata encodedParams
    ) external returns (bool) {
        if (msg.sender != address(aavePool) || initiator != address(this)) {
            revert InvalidFlashLoanCallback();
        }

        (address caller, address debtAsset, LiquidationParams memory params) =
            abi.decode(encodedParams, (address, address, LiquidationParams));
        _validateRequest(debtAsset, amount, params);
        if (asset != debtAsset) revert InvalidFlashLoanCallback();

        IERC20 debt = IERC20(debtAsset);
        IERC20 collateral = IERC20(params.collateralAsset);

        debt.forceApprove(address(aavePool), params.debtToCover);
        aavePool.liquidationCall(
            params.collateralAsset,
            debtAsset,
            params.borrower,
            params.debtToCover,
            false
        );

        if (params.collateralAsset != debtAsset) {
            if (params.unwindTarget == address(0)) revert MissingUnwindTarget();
            if (!whitelistedUnwindTargets[params.unwindTarget]) {
                revert UnwindTargetNotWhitelisted(params.unwindTarget);
            }
            uint256 collateralBalance = collateral.balanceOf(address(this));
            collateral.forceApprove(params.unwindTarget, collateralBalance);
            (bool ok, bytes memory reason) = params.unwindTarget.call(params.unwindCalldata);
            if (!ok) revert UnwindCallFailed(reason);
        }

        uint256 repayment = amount + premium;
        uint256 debtBalance = debt.balanceOf(address(this));
        if (debtBalance < params.minDebtAssetOut) {
            revert InsufficientDebtAssetOut(debtBalance, params.minDebtAssetOut);
        }
        if (debtBalance < repayment + params.minProfit) {
            uint256 observedProfit = debtBalance > repayment ? debtBalance - repayment : 0;
            revert InsufficientProfit(observedProfit, params.minProfit);
        }

        debt.forceApprove(address(aavePool), repayment);
        uint256 profit = debtBalance - repayment;
        address beneficiary = params.beneficiary == address(0) ? caller : params.beneficiary;
        if (profit > 0) debt.safeTransfer(beneficiary, profit);

        emit LiquidationExecuted(
            params.borrower,
            debtAsset,
            params.collateralAsset,
            params.debtToCover,
            premium,
            profit,
            beneficiary
        );

        return true;
    }

    function _validateRequest(
        address debtAsset,
        uint256 debtToCover,
        LiquidationParams memory params
    ) internal pure {
        if (
            debtAsset == address(0) || params.collateralAsset == address(0)
                || params.borrower == address(0) || debtToCover == 0
        ) {
            revert InvalidAddress();
        }
        if (params.receiveAToken) revert ReceiveATokenUnsupported();
        if (params.debtToCover != debtToCover) {
            revert DebtAmountMismatch(debtToCover, params.debtToCover);
        }
    }
}
