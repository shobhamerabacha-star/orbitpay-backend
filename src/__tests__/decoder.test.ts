import { xdr, Address } from '@stellar/stellar-sdk';
import { decodeEventData, normalizeNativeValue, decodeScVal } from '../lib/indexer/decoder';

describe('Soroban XDR Event Decoder and Envelope Validation', () => {
  const dummyTxHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const dummyContractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
  const dummyAddress = 'GDT3EV6ANB7VGT5UCDQQYHZR6YRDK6E5MHYS22Q5N5BZNCXTH3PFWTJW';

  describe('Envelope validation (visible decode failure)', () => {
    it('returns null when event is null or non-object', () => {
      expect(decodeEventData(null)).toBeNull();
      expect(decodeEventData(undefined)).toBeNull();
      expect(decodeEventData('invalid' as any)).toBeNull();
    });

    it('returns null when event id is missing or empty', () => {
      const event = {
        ledger: 100,
        txHash: dummyTxHash,
        contractId: dummyContractId,
        topic: ['Deposit'],
      };
      expect(decodeEventData(event as any)).toBeNull();
      expect(decodeEventData({ ...event, id: '   ' } as any)).toBeNull();
    });

    it('returns null when ledger is invalid (0, negative, non-integer, or missing)', () => {
      const base = {
        id: 'ev-1',
        txHash: dummyTxHash,
        contractId: dummyContractId,
        topic: ['Deposit'],
      };
      expect(decodeEventData({ ...base, ledger: 0 } as any)).toBeNull();
      expect(decodeEventData({ ...base, ledger: -5 } as any)).toBeNull();
      expect(decodeEventData({ ...base, ledger: 10.5 } as any)).toBeNull();
      expect(decodeEventData({ ...base } as any)).toBeNull();
    });

    it('returns null when txHash is missing, empty, or manufactured as "unknown"', () => {
      const base = {
        id: 'ev-1',
        ledger: 100,
        contractId: dummyContractId,
        topic: ['Deposit'],
      };
      expect(decodeEventData({ ...base } as any)).toBeNull();
      expect(decodeEventData({ ...base, txHash: '' } as any)).toBeNull();
      expect(decodeEventData({ ...base, txHash: 'unknown' } as any)).toBeNull();
    });

    it('returns null when contractId is missing, empty, or manufactured as "unknown"', () => {
      const base = {
        id: 'ev-1',
        ledger: 100,
        txHash: dummyTxHash,
        topic: ['Deposit'],
      };
      expect(decodeEventData({ ...base } as any)).toBeNull();
      expect(decodeEventData({ ...base, contractId: '' } as any)).toBeNull();
      expect(decodeEventData({ ...base, contractId: 'unknown' } as any)).toBeNull();
    });

    it('returns null when topics are missing or empty', () => {
      const base = {
        id: 'ev-1',
        ledger: 100,
        txHash: dummyTxHash,
        contractId: dummyContractId,
      };
      expect(decodeEventData({ ...base } as any)).toBeNull();
      expect(decodeEventData({ ...base, topic: [] } as any)).toBeNull();
    });
  });

  describe('ScVal decoding for primitives and structures', () => {
    it('decodes symbols and addresses explicitly', () => {
      const sym = xdr.ScVal.scvSymbol('StreamCreated');
      const addr = Address.fromString(dummyAddress).toScVal();

      expect(decodeScVal(sym)).toBe('StreamCreated');
      expect(decodeScVal(addr)).toBe(dummyAddress);
    });

    it('decodes large integers (i128, u64) losslessly', () => {
      const u64Val = xdr.ScVal.scvU64(new xdr.Int64(9007199254740993n)); // 2^53 + 1
      const i128Val = xdr.ScVal.scvI128(
        new xdr.Int128Parts({ hi: new xdr.Int64(1n), lo: new xdr.Uint64(2n) }),
      );

      expect(decodeScVal(u64Val)).toBe('9007199254740993');
      expect(typeof decodeScVal(i128Val)).toBe('string');
    });

    it('decodes maps, vectors, and booleans', () => {
      const mapVal = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('active'),
          val: xdr.ScVal.scvBool(true),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('tags'),
          val: xdr.ScVal.scvVec([
            xdr.ScVal.scvSymbol('soroban'),
            xdr.ScVal.scvSymbol('orbitpay'),
          ]),
        }),
      ]);

      const decoded: any = decodeScVal(mapVal);
      expect(decoded).toEqual({
        active: true,
        tags: ['soroban', 'orbitpay'],
      });
    });

    it('decodes wrapped XDR base64 and raw base64 strings', () => {
      const sym = xdr.ScVal.scvSymbol('TreasuryDeposit');
      const b64 = sym.toXDR('base64');

      expect(decodeScVal(b64)).toBe('TreasuryDeposit');
      expect(decodeScVal({ xdr: b64 })).toBe('TreasuryDeposit');
    });
  });

  describe('Captured fixtures from configured contracts', () => {
    it('decodes Treasury contract fixture', () => {
      const topicSym = xdr.ScVal.scvSymbol('TreasuryDeposit');
      const map = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('depositor'),
          val: Address.fromString(dummyAddress).toScVal(),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('amount'),
          val: xdr.ScVal.scvI128(
            new xdr.Int128Parts({ hi: new xdr.Int64(0n), lo: new xdr.Uint64(1000000n) }),
          ),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('token'),
          val: xdr.ScVal.scvSymbol('USDC'),
        }),
      ]);

      const event = {
        id: 'treasury-ev-01',
        ledger: 500,
        txHash: dummyTxHash,
        contractId: dummyContractId,
        topic: [topicSym.toXDR('base64')],
        value: { xdr: map.toXDR('base64') },
        ledgerClosedAt: '2026-09-09T10:00:00Z',
      };

      const decoded = decodeEventData(event);
      expect(decoded).not.toBeNull();
      expect(decoded?.eventId).toBe('treasury-ev-01');
      expect(decoded?.topic).toBe('TreasuryDeposit');
      expect(decoded?.data.depositor).toBe(dummyAddress);
      expect(decoded?.data.amount).toBe('1000000');
      expect(decoded?.data.token).toBe('USDC');
      expect(decoded?.timestamp).toBe(Math.floor(new Date('2026-09-09T10:00:00Z').getTime() / 1000));
    });

    it('decodes PayrollStream contract fixture', () => {
      const topicSym = xdr.ScVal.scvSymbol('StreamCreated');
      const map = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('stream_id'),
          val: xdr.ScVal.scvU64(new xdr.Int64(777n)),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('sender'),
          val: Address.fromString(dummyAddress).toScVal(),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('recipient'),
          val: Address.fromString('GBHFQYDXSI6XTELXJDIVJNBWXBY2YINJFKANLFYUUUMKJ74E46AGIOPD').toScVal(),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('amount'),
          val: xdr.ScVal.scvI128(
            new xdr.Int128Parts({ hi: new xdr.Int64(0n), lo: new xdr.Uint64(50000000n) }),
          ),
        }),
      ]);

      const event = {
        id: 'payroll-ev-02',
        ledger: 501,
        txHash: dummyTxHash,
        contractId: dummyContractId,
        topic: [topicSym],
        value: map,
        ledgerClosedAt: '2026-09-09T10:05:00Z',
      };

      const decoded = decodeEventData(event);
      expect(decoded).not.toBeNull();
      expect(decoded?.topic).toBe('StreamCreated');
      expect(decoded?.data.stream_id).toBe('777');
      expect(decoded?.data.sender).toBe(dummyAddress);
      expect(decoded?.data.recipient).toBe('GBHFQYDXSI6XTELXJDIVJNBWXBY2YINJFKANLFYUUUMKJ74E46AGIOPD');
      expect(decoded?.data.amount).toBe('50000000');
    });

    it('decodes Governance VoteCast contract fixture', () => {
      const topicSym = xdr.ScVal.scvSymbol('VoteCast');
      const map = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('proposal_id'),
          val: xdr.ScVal.scvU64(new xdr.Int64(12n)),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('voter'),
          val: Address.fromString(dummyAddress).toScVal(),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('support'),
          val: xdr.ScVal.scvBool(true),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('weight'),
          val: xdr.ScVal.scvU32(100),
        }),
      ]);

      const event = {
        id: 'gov-ev-03',
        ledger: 502,
        txHash: dummyTxHash,
        contractId: dummyContractId,
        topic: [topicSym],
        value: map,
      };

      const decoded = decodeEventData(event);
      expect(decoded).not.toBeNull();
      expect(decoded?.topic).toBe('VoteCast');
      expect(decoded?.data.proposal_id).toBe('12');
      expect(decoded?.data.voter).toBe(dummyAddress);
      expect(decoded?.data.support).toBe(true);
      expect(decoded?.data.weight).toBe(100);
    });
  });
});
