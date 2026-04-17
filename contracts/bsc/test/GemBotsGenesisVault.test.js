const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('GemBotsGenesisVault', function () {
  async function deployFixture() {
    const [owner, holderA, holderB, outsider] = await ethers.getSigners();
    const MockGenesisNFA = await ethers.getContractFactory('MockGenesisNFA');
    const nfa = await MockGenesisNFA.deploy();
    await nfa.waitForDeployment();

    await nfa.mint(holderA.address, 1);
    await nfa.mint(holderB.address, 2);

    const GemBotsGenesisVault = await ethers.getContractFactory('GemBotsGenesisVault');
    const vault = await GemBotsGenesisVault.deploy(await nfa.getAddress());
    await vault.waitForDeployment();

    return { owner, holderA, holderB, outsider, nfa, vault };
  }

  it('distributes correctly across multiple deposits and multiple claims', async function () {
    const { owner, holderA, vault } = await deployFixture();

    await owner.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther('1.0') });
    expect(await vault.pendingReward(1)).to.equal(ethers.parseEther('0.01'));

    await expect(() => vault.connect(holderA).claim(1)).to.changeEtherBalances(
      [vault, holderA],
      [-ethers.parseEther('0.01'), ethers.parseEther('0.01')]
    );

    await owner.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther('2.0') });
    expect(await vault.pendingReward(1)).to.equal(ethers.parseEther('0.02'));

    await expect(() => vault.connect(holderA).claim(1)).to.changeEtherBalances(
      [vault, holderA],
      [-ethers.parseEther('0.02'), ethers.parseEther('0.02')]
    );
  });

  it('late claimer receives the same total reward as early claimer under equal deposits', async function () {
    const { owner, holderA, holderB, vault } = await deployFixture();

    await owner.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther('1.0') });
    await expect(() => vault.connect(holderA).claim(1)).to.changeEtherBalances(
      [vault, holderA],
      [-ethers.parseEther('0.01'), ethers.parseEther('0.01')]
    );

    await owner.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther('1.0') });

    await expect(() => vault.connect(holderA).claim(1)).to.changeEtherBalances(
      [vault, holderA],
      [-ethers.parseEther('0.01'), ethers.parseEther('0.01')]
    );

    await expect(() => vault.connect(holderB).claim(2)).to.changeEtherBalances(
      [vault, holderB],
      [-ethers.parseEther('0.02'), ethers.parseEther('0.02')]
    );
  });

  it('blocks claim when emergency pause is enabled', async function () {
    const { owner, holderA, vault } = await deployFixture();

    await owner.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther('1.0') });
    await vault.connect(owner).emergencyPause();

    await expect(vault.connect(holderA).claim(1)).to.be.revertedWith('Claims paused');
  });

  it('reverts when a non-owner tries to claim rewards', async function () {
    const { owner, holderB, vault } = await deployFixture();

    await owner.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther('1.0') });
    await expect(vault.connect(holderB).claim(1)).to.be.revertedWith('Not owner');
  });

  it('reverts for token ids outside the genesis range', async function () {
    const { holderB, vault } = await deployFixture();

    await expect(vault.connect(holderB).claim(0)).to.be.revertedWith('Not genesis');
    await expect(vault.connect(holderB).claim(101)).to.be.revertedWith('Not genesis');
  });

  it('stores pending payments for non-receiving holders and lets them claim later', async function () {
    const { owner, holderA, nfa, vault } = await deployFixture();
    const NonReceivingMock = await ethers.getContractFactory('NonReceivingMock');
    const receiver = await NonReceivingMock.connect(holderA).deploy();
    await receiver.waitForDeployment();

    await nfa.connect(holderA).transferFrom(holderA.address, await receiver.getAddress(), 1);
    await owner.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther('1.0') });

    await expect(receiver.connect(holderA).claimFromVault(await vault.getAddress(), 1)).to.not.be.reverted;

    expect(await vault.pendingPayment(await receiver.getAddress())).to.equal(ethers.parseEther('0.01'));
    expect(await ethers.provider.getBalance(await receiver.getAddress())).to.equal(0n);

    await receiver.connect(holderA).setAcceptPayments(true);
    const vaultAddress = await vault.getAddress();
    await expect(() => receiver.connect(holderA).claimPendingFromVault(vaultAddress)).to.changeEtherBalances(
      [vault, receiver],
      [-ethers.parseEther('0.01'), ethers.parseEther('0.01')]
    );

    expect(await vault.pendingPayment(await receiver.getAddress())).to.equal(0n);
  });

  it('reverts on a second claim when no new rewards were deposited', async function () {
    const { owner, holderA, vault } = await deployFixture();

    await owner.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther('1.0') });
    await vault.connect(holderA).claim(1);

    await expect(vault.connect(holderA).claim(1)).to.be.revertedWith('Nothing to claim');
  });

  it('supports pause and resume lifecycle for claims', async function () {
    const { owner, holderA, vault } = await deployFixture();

    await owner.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther('1.0') });
    await vault.connect(owner).emergencyPause();
    await expect(vault.connect(holderA).claim(1)).to.be.revertedWith('Claims paused');

    await vault.connect(owner).resume();
    await expect(() => vault.connect(holderA).claim(1)).to.changeEtherBalances(
      [vault, holderA],
      [-ethers.parseEther('0.01'), ethers.parseEther('0.01')]
    );
  });
});
