import { useCallback, useEffect, useState } from 'react';
import { createDaoReader } from '../lib/dao-reader';
import { type Proposal } from '../lib/dao-types';

export interface UseDaoResult {
  proposals: Proposal[];
  treasury: bigint;
  memberCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useDao(contractAddress: string | null): UseDaoResult {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [treasury, setTreasury] = useState(0n);
  const [memberCount, setMemberCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!contractAddress) return;
    setLoading(true);
    try {
      const reader = createDaoReader(contractAddress);
      const [ps, treasuryValue, count] = await Promise.all([
        reader.getProposals(),
        reader.getTreasury(),
        reader.getMemberCount(),
      ]);
      setProposals(ps);
      setTreasury(treasuryValue);
      setMemberCount(count);
    } finally {
      setLoading(false);
    }
  }, [contractAddress]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { proposals, treasury, memberCount, loading, refresh };
}