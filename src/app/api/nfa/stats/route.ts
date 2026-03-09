import { NextResponse } from 'next/server';
import { ethers } from 'ethers';

const NFA_CONTRACT = process.env.NEXT_PUBLIC_BSC_NFA_CONTRACT_ADDRESS || '0x9bC5f392cE8C7aA13BD5bC7D5A1A12A4DD58b3D5';
const BSC_RPC = process.env.NEXT_PUBLIC_BSC_RPC || 'https://bsc-dataseed.binance.org/';

const ABI = [
  'function totalSupply() view returns (uint256)',
  'function genesisCount() view returns (uint256)',
  'function mintFee() view returns (uint256)',
];

export async function GET() {
  try {
    const provider = new ethers.JsonRpcProvider(BSC_RPC);
    const contract = new ethers.Contract(NFA_CONTRACT, ABI, provider);
    
    const [totalSupply, genesisCount, mintFee] = await Promise.all([
      contract.totalSupply(),
      contract.genesisCount(),
      contract.mintFee(),
    ]);

    return NextResponse.json({
      totalSupply: Number(totalSupply),
      genesisCount: Number(genesisCount),
      mintFee: ethers.formatEther(mintFee),
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' }
    });
  } catch (e: any) {
    // Fallback to known values if RPC fails
    return NextResponse.json({
      totalSupply: 100,
      genesisCount: 100,
      mintFee: '0.1',
      error: e.message,
    });
  }
}
