import React, { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import GlassSheet from './GlassSheet';
import WatchlistSubmissionForm from './WatchlistSubmissionForm';
import { WATCHLIST_STATUS, WatchlistEntry } from '../src/watchlist';

const WatchlistQuickAddSheet: React.FC<{ userId: string; customerId: string; onClose: () => void }> = ({ userId, customerId, onClose }) => {
  const [busy, setBusy] = useState(false), [result, setResult] = useState<WatchlistEntry | null>(null);
  return <GlassSheet title="В чёрный список" zIndex={260} onClose={onClose} confirmClose={() => !busy}>
    {result ? <div role="status" className="space-y-3 p-6 text-center"><CheckCircle2 size={36} className="mx-auto text-emerald-500" aria-hidden="true" /><p className="font-semibold break-words">{result.name}</p><p className="text-sm text-slate-500">{WATCHLIST_STATUS[result.status]}</p></div>
      : <WatchlistSubmissionForm userId={userId} customerId={customerId} onSaved={setResult} onBusyChange={setBusy} />}
  </GlassSheet>;
};
export default WatchlistQuickAddSheet;
