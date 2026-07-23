import {Sliders} from 'lucide-react';
import type {ClientStatus, LinkItem} from '../../types';

interface ClientStatusTableProps {
  clients: ClientStatus[];
  selectedClientId: string;
  setSelectedClientId: (id: string) => void;
  selectedClient: ClientStatus | undefined;
  clientResourceTab: string;
  setClientResourceTab: (tab: string) => void;
  RESOURCE_CATEGORIES: { id: string; label: string }[];
  handleDeploySingleAsset: (resourceFilter?: string, fileFilter?: string, clientFilter?: string) => Promise<void>;
  handleOpenDiffModal: (linkItem: LinkItem) => Promise<void>;
}

export function ClientStatusTable({
  clients,
  selectedClientId,
  setSelectedClientId,
  selectedClient,
  clientResourceTab,
  setClientResourceTab,
  RESOURCE_CATEGORIES,
  handleDeploySingleAsset,
  handleOpenDiffModal
}: ClientStatusTableProps) {
  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h2 className="text-xl font-bold text-white flex items-center space-x-2 font-sans">
          <Sliders className="w-6 h-6 text-indigo-400" />
          <span>AI 클라이언트 현황 및 심링크 연결상태</span>
        </h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {clients.map(client => (
          <button
            key={client.id}
            onClick={() => setSelectedClientId(client.id)}
            className={`p-3 rounded-xl border text-xs text-left transition-all ${
              selectedClientId === client.id ? 'bg-slate-800 border-blue-500 text-white' : 'bg-slate-900/60 border-slate-800 text-slate-400'
            }`}
          >
            <div className="font-bold">{client.name}</div>
            <div className="text-[10px] text-slate-500 mt-1">{client.isFullyLinked ? 'Connected' : 'Not Linked'}</div>
          </button>
        ))}
      </div>

      {selectedClient && (
        <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-2xl space-y-6">
          <div className="pb-4 border-b border-slate-800">
            <h3 className="font-bold text-white font-sans">{selectedClient.name} 설정 현황</h3>
            <p className="text-xs text-slate-500 font-mono mt-1">{selectedClient.detectedPath}</p>
          </div>

          <div className="flex items-center space-x-2 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
            {RESOURCE_CATEGORIES.map(category => (
              <button
                key={category.id}
                onClick={() => setClientResourceTab(category.id)}
                className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${
                  clientResourceTab === category.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {category.label} ({(selectedClient.categorizedLinks[category.id] || []).length})
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {(selectedClient.categorizedLinks[clientResourceTab] || []).map((link, idx) => (
              <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-slate-950/50 border border-slate-800 text-xs">
                <div>
                  <div className="font-semibold text-slate-300 font-sans">{link.name}</div>
                  <div className="text-[10px] text-slate-500 font-mono mt-0.5 truncate max-w-lg">{link.target}</div>
                </div>

                <div className="flex space-x-2 shrink-0">
                  <button
                    onClick={() => { handleDeploySingleAsset(clientResourceTab, link.source, selectedClient.id).catch(console.error); }}
                    className="px-2.5 py-1 bg-amber-600/20 hover:bg-amber-600/40 text-amber-300 border border-amber-500/30 rounded text-[11px] font-semibold transition-colors"
                  >
                    즉시 적용
                  </button>
                  <button
                    onClick={() => { handleOpenDiffModal(link).catch(console.error); }}
                    className="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/30 rounded text-[11px] font-semibold transition-colors"
                  >
                    Diff 대조
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
