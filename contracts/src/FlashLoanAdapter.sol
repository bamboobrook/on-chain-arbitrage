// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC3156FlashBorrower} from "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";
import {IERC3156FlashLender} from "@openzeppelin/contracts/interfaces/IERC3156FlashLender.sol";

/// @title FlashLoanAdapter
/// @notice Wraps EIP-3156 flash lenders (Aave V3 is EIP-3156-ish via its own
///         callback; this adapter exposes the canonical ERC-3156 flow used by
///         many V2-style tokens and Balancer). The StrategyExecutor uses it to
///         borrow principal for a route, then repays principal + premium within
///         the same transaction.
/// @dev    Premium must be covered by profit; the executor reverts otherwise.
contract FlashLoanAdapter is IERC3156FlashBorrower {
    using SafeERC20 for IERC20;

    bytes32 internal constant _CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");

    address public immutable executor;

    error NotExecutor();
    error NotAuthorizedLender();

    modifier onlyExecutor() {
        if (msg.sender != executor) revert NotExecutor();
        _;
    }

    constructor(address executor_) {
        executor = executor_;
    }

    /// @notice Borrow `amount` of `token` from `lender`, executing the route
    ///         callback on the executor, then repay principal + premium.
    /// @dev    The executor must have set up the route and approved repayment.
    function borrow(IERC3156FlashLender lender, IERC20 token, uint256 amount, bytes calldata data)
        external
        onlyExecutor
    {
        // Lender will call back onFlashLoan; the executor orchestrates the swap
        // route inside that callback and approves repayment.
        lender.flashLoan(this, address(token), amount, data);
    }

    /// @inheritdoc IERC3156FlashBorrower
    function onFlashLoan(address initiator, address token, uint256 amount, uint256 fee, bytes calldata data)
        external
        returns (bytes32)
    {
        // Only accept loans initiated by ourselves (initiator == this adapter).
        if (initiator != address(this)) revert NotAuthorizedLender();
        // Approve the lender to pull principal + fee.
        IERC20(token).safeIncreaseAllowance(msg.sender, amount + fee);
        // Hand control to the executor to run the route. The executor is
        // expected to have produced >= amount + fee by the time we return.
        (bool ok,) = executor.call(data);
        require(ok, "FlashLoanAdapter: executor callback failed");
        return _CALLBACK_SUCCESS;
    }
}
