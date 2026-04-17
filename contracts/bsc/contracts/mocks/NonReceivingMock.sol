// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IGenesisVaultForMock {
    function claim(uint256 tokenId) external;
    function claimPendingPayment() external;
}

contract NonReceivingMock {
    bool public acceptPayments;

    function claimFromVault(address vault, uint256 tokenId) external {
        IGenesisVaultForMock(vault).claim(tokenId);
    }

    function claimPendingFromVault(address vault) external {
        IGenesisVaultForMock(vault).claimPendingPayment();
    }

    function setAcceptPayments(bool value) external {
        acceptPayments = value;
    }

    receive() external payable {
        require(acceptPayments, "No direct payments");
    }
}
