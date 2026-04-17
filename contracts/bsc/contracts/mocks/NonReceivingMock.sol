// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IGenesisVaultClaim {
    function claim(uint256 tokenId) external;
    function claimPendingPayment() external;
}

contract NonReceivingMock {
    bool public rejectPayments = true;

    function setRejectPayments(bool shouldReject) external {
        rejectPayments = shouldReject;
    }

    function claim(address vault, uint256 tokenId) external {
        IGenesisVaultClaim(vault).claim(tokenId);
    }

    function claimPending(address vault) external {
        IGenesisVaultClaim(vault).claimPendingPayment();
    }

    receive() external payable {
        require(!rejectPayments, 'Rejecting payment');
    }
}
