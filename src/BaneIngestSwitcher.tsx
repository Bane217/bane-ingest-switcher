import React, { useState, useEffect, useRef, useCallback } from 'react';
import { OBSWebSocket } from 'obs-websocket-js';;
import { 
  Cast,
  Link as LinkIcon,
  Settings,
  RefreshCw, 
  Plus, 
  Download, 
  Upload, 
  Play,
  Unplug,
  Edit2,
  Check,
  X,
  Radio,
  Circle
} from 'lucide-react';

// --- Types ---
type LinkItem = {
  id: string;
  name: string;
  url: string;
};

type OBSSource = {
  name: string;
  kind: string;
};

// --- Constants ---
const STORAGE_KEY_LINKS = 'bane-ingest-links';
const STORAGE_KEY_CONN = 'bane-obs-connection';

// Sources that definitely support simple URL switching via 'local_file' or 'url' settings
const SUPPORTED_KINDS = new Set([
  'ffmpeg_source',
  'vlc_source',
  'browser_source',
]);

export default function BaneIngestSwitcher() {
  // --- State: Connection ---
  const [address, setAddress] = useState('localhost');
  const [port, setPort] = useState('4455');
  const [password, setPassword] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);
  const [isConnectPanelOpen, setIsConnectPanelOpen] = useState(true);

  // --- State: OBS Data ---
  const [sources, setSources] = useState<OBSSource[]>([]);
  const [selectedSource, setSelectedSource] = useState<string>('');
  const [currentSourceUrl, setCurrentSourceUrl] = useState<string | null>(null);

  // --- State: Links ---
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [tempName, setTempName] = useState('');
  const [tempUrl, setTempUrl] = useState('');

  const obs = useRef<OBSWebSocket | null>(null);

  // --- Initialization ---
  useEffect(() => {
    obs.current = new OBSWebSocket();

    // Load persisted data
    try {
      const savedLinks = localStorage.getItem(STORAGE_KEY_LINKS);
if (savedLinks) setLinks(JSON.parse(savedLinks) as LinkItem[]);

    const savedConn = localStorage.getItem(STORAGE_KEY_CONN);
if (savedConn) {
  const { address: sAddr, port: sPort, password: sPass } =
    JSON.parse(savedConn) as { address?: string; port?: string; password?: string };
  if (sAddr) setAddress(sAddr);
  if (sPort) setPort(sPort);
  if (sPass) setPassword(sPass);
}
    } catch (e) {
      console.error("Failed to load saved data", e);
    }

    return () => {
      if (obs.current) {
        try { obs.current.disconnect(); } catch (e) { /* ignore */ }
      }
    };
  }, []);

  // Persist links
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_LINKS, JSON.stringify(links));
  }, [links]);

  // --- OBS Connection Logic ---
  const connectToOBS = async () => {
    setConnError(null);
    if (!obs.current) obs.current = new OBSWebSocket();

    try {
      const wsUrl = `ws://${address}:${port}`;
      await obs.current.connect(wsUrl, password);
      setIsConnected(true);
      setIsConnectPanelOpen(false);
      
      localStorage.setItem(STORAGE_KEY_CONN, JSON.stringify({ address, port, password }));

      // Setup listeners
      obs.current.on('ConnectionClosed', () => {
        setIsConnected(false);
        setConnError("Connection lost.");
        setCurrentSourceUrl(null);
      });

      obs.current.on('InputSettingsChanged', (event) => {
        // If the currently selected source changed settings, update our active state
        // We need to use a ref or functional state update to get the *current* selectedSource if we were using it directly, 
        // but here we can just check if the event matches the current selection in state.
        // NOTE: In a real-world complex app, better to use refs for current selection inside callbacks.
        // For simplicity here, we'll just re-fetch active state if the name matches.
        // Actually, we can just blindly try to update if it matches.
         updateActiveStateIfMatches(event.inputName);
      });

      // Initial fetch
      await fetchSources();

    } catch (error: any) {
      console.error('OBS Connection failed', error);
      setIsConnected(false);
      setConnError(error?.message || "Failed to connect. Check details.");
    }
  };

  const disconnectOBS = async () => {
    if (obs.current) {
      await obs.current.disconnect();
      setIsConnected(false);
      setCurrentSourceUrl(null);
    }
  };

  // Helpers to keep state in sync inside event callbacks if needed, 
  // but for simplicity we'll rely on regular polling or react-hooks deps where possible.
  // To fix the stale closure issue in the event listener, we can use a ref for SelectedSource.
  const selectedSourceRef = useRef(selectedSource);
  useEffect(() => { selectedSourceRef.current = selectedSource; }, [selectedSource]);

  const updateActiveStateIfMatches = async (changedInputName: string) => {
    if (changedInputName === selectedSourceRef.current) {
      fetchActiveState(changedInputName);
    }
  };

  const fetchActiveState = useCallback(async (sourceName: string) => {
    if (!obs.current || !isConnected || !sourceName) return;
    try {
       const { inputSettings, inputKind } = await obs.current.call('GetInputSettings', { inputName: sourceName });
       // Extract URL based on kind. Browser source uses 'url', ffmpeg/vlc usually 'local_file'
       let activeUrl = '';
       if (inputKind === 'browser_source') {
         activeUrl = (inputSettings.url as string) || '';
       } else {
         // fallback for ffmpeg, vlc, etc.
         activeUrl = (inputSettings.local_file as string) || (inputSettings.url as string) || '';
       }
       setCurrentSourceUrl(activeUrl);
    } catch (e) {
      // silent fail if source doesn't exist anymore
    }
  }, [isConnected]);

  // Refresh active state when selection changes
  useEffect(() => {
    if (selectedSource && isConnected) {
      fetchActiveState(selectedSource);
    } else {
      setCurrentSourceUrl(null);
    }
  }, [selectedSource, isConnected, fetchActiveState]);


  const fetchSources = useCallback(async () => {
    if (!obs.current || !isConnected) return;
    try {
      const { inputs } = await obs.current.call('GetInputList');
      const mediaSources = inputs
        .filter(input => {
  const kind = input.inputKind as string | null;
  return kind && SUPPORTED_KINDS.has(kind);
})
        .map(input => ({ name: input.inputName as string, kind: input.inputKind as string }));
      
      setSources(mediaSources);

      if (mediaSources.length > 0) {
        // If current selection is invalid, reset it to first available
        if (!selectedSource || !mediaSources.find(s => s.name === selectedSource)) {
          setSelectedSource(mediaSources[0].name);
        }
      } else {
        setSelectedSource('');
      }
    } catch (error) {
      console.error("Failed to fetch sources", error);
    }
  }, [isConnected, selectedSource]);

  // --- Media Switching Logic ---
  const switchMedia = async (link: LinkItem) => {
    if (!obs.current || !isConnected || !selectedSource) return;

    const source = sources.find(s => s.name === selectedSource);
    if (!source) {
      alert("Source not found. Refreshing...");
      fetchSources();
      return;
    }

    const isNetworkLink = link.url.startsWith('http') || link.url.startsWith('rtmp') || link.url.startsWith('srt') || link.url.startsWith('udp');
    let settings = {};

    switch (source.kind) {
      case 'ffmpeg_source':
      case 'vlc_source':
        settings = {
          local_file: link.url,
          is_local_file: !isNetworkLink,
        };
        break;
      case 'browser_source':
        settings = { url: link.url };
        break;
      default:
        settings = { local_file: link.url, url: link.url };
        break;
    }

    try {
      await obs.current.call('SetInputSettings', {
        inputName: selectedSource,
        inputSettings: settings,
        overlay: true
      });
      setCurrentSourceUrl(link.url);
    } catch (error: any) {
      alert(`Failed to switch: ${error?.message}`);
    }
  };

  // --- Link Management ---
  const handleAddLink = () => {
    if (!tempName.trim() || !tempUrl.trim()) return;
    setLinks([...links, { id: Math.random().toString(36).substring(2, 9), name: tempName, url: tempUrl }]);
    setTempName('');
    setTempUrl('');
  };

  const handleDeleteLink = (id: string) => {
    setLinks(links.filter(l => l.id !== id));
  };

  const startEditing = (link: LinkItem) => {
    setEditingLinkId(link.id);
    setTempName(link.name);
    setTempUrl(link.url);
  };

  const saveEditing = () => {
    setLinks(links.map(l => l.id === editingLinkId ? { ...l, name: tempName, url: tempUrl } : l));
    setEditingLinkId(null);
    setTempName('');
    setTempUrl('');
  };

  const handleExport = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(links, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = "bane_ingest_links.json";
    a.click();
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const result = JSON.parse(e.target?.result as string);
          if (Array.isArray(result)) {
             const newLinks = result.filter((l: any) => l.name && l.url).map((l: any) => ({ ...l, id: Math.random().toString(36).substring(2, 9) }));
             setLinks(prev => [...prev, ...newLinks]);
          }
        } catch (err) {
          alert("Failed to import JSON.");
        }
      };
      reader.readAsText(file);
    }
    event.target.value = '';
  };

  // --- RENDER ---
  return (
    <div className="min-h-screen bg-black text-white font-sans p-6 md:p-12 flex flex-col items-center selection:bg-neutral-800 selection:text-white">
      
      {/* Header */}
      <header className="w-full max-w-5xl mb-16 flex flex-col md:flex-row justify-between items-center text-center md:text-left gap-6">
        <div>
          <h1 className="text-3xl md:text-5xl font-medium tracking-tight mb-2 text-white">
            Bane Ingest Switcher
          </h1>
          <p className="text-neutral-400 font-medium">
            OBS WebSocket Link Manager
          </p>
        </div>
        <a 
          href="https://linktr.ee/baneeminent" 
          target="_blank" 
          rel="noopener noreferrer"
          className="group flex items-center gap-2 px-5 py-2.5 bg-neutral-900/50 hover:bg-neutral-800 border border-neutral-800 rounded-full transition-all"
        >
          <span className="text-sm text-neutral-400 group-hover:text-white transition-colors">created by @baneeminent</span>
        </a>
      </header>

      <main className="w-full max-w-5xl space-y-16">

        {/* Connection Panel (Pill Style) */}
        <div className="flex justify-center sticky top-6 z-10">
           <div className={`bg-neutral-900/90 backdrop-blur-xl border border-neutral-800 shadow-2xl rounded-[2.5rem] overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${isConnectPanelOpen ? 'w-full max-w-xl p-2' : 'w-auto'}`}>
              
              {/* Collapsed Trigger */}
              <button 
                className={`flex items-center gap-4 px-8 py-4 hover:bg-neutral-800/50 transition-colors ${isConnectPanelOpen ? 'hidden' : 'flex'}`}
                onClick={() => setIsConnectPanelOpen(true)}
              >
                <div className="relative flex h-3 w-3">
                  {isConnected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>}
                  <span className={`relative inline-flex rounded-full h-3 w-3 ${isConnected ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
                </div>
                <span className="font-medium text-white">
                  {isConnected ? 'OBS Connected' : 'OBS Disconnected'}
                </span>
                <Settings className="w-5 h-5 text-neutral-500" />
              </button>

              {/* Expanded Form */}
              <div className={`${isConnectPanelOpen ? 'block' : 'hidden'} p-6 md:p-8 space-y-8`}>
                <div className="flex justify-between items-center">
                  <h2 className="text-xl font-medium text-white">Connection Settings</h2>
                  <button onClick={() => setIsConnectPanelOpen(false)} className="p-2 bg-neutral-800 hover:bg-neutral-700 rounded-full text-neutral-400 hover:text-white transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-5">
                  <div>
                     <label className="block ml-4 mb-2 text-xs font-bold uppercase tracking-widest text-neutral-500">IP Address</label>
                     <input 
                       type="text" 
                       value={address} 
                       onChange={e => setAddress(e.target.value)} 
                       disabled={isConnected}
                       className="w-full bg-black border border-neutral-800 rounded-full px-6 py-4 text-white placeholder:text-neutral-600 focus:border-white focus:outline-none transition-colors disabled:opacity-50"
                       placeholder="localhost"
                     />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block ml-4 mb-2 text-xs font-bold uppercase tracking-widest text-neutral-500">Port</label>
                        <input 
                          type="text" 
                          value={port} 
                          onChange={e => setPort(e.target.value)} 
                          disabled={isConnected}
                          className="w-full bg-black border border-neutral-800 rounded-full px-6 py-4 text-white placeholder:text-neutral-600 focus:border-white focus:outline-none transition-colors disabled:opacity-50"
                          placeholder="4455"
                        />
                    </div>
                    <div>
                        <label className="block ml-4 mb-2 text-xs font-bold uppercase tracking-widest text-neutral-500">Password</label>
                        <input 
                          type="password" 
                          value={password} 
                          onChange={e => setPassword(e.target.value)} 
                          disabled={isConnected}
                          className="w-full bg-black border border-neutral-800 rounded-full px-6 py-4 text-white placeholder:text-neutral-600 focus:border-white focus:outline-none transition-colors disabled:opacity-50"
                          placeholder="••••••"
                        />
                    </div>
                  </div>
                </div>

                <button 
                   onClick={isConnected ? disconnectOBS : connectToOBS}
                   className={`w-full py-4 rounded-full font-bold tracking-wide uppercase flex items-center justify-center gap-3 transition-all active:scale-95 ${isConnected ? 'bg-neutral-800 text-white hover:bg-neutral-700' : 'bg-white hover:bg-neutral-200 text-black'}`}
                 >
                   {isConnected ? <><Unplug className="w-5 h-5"/> Disconnect</> : <><Cast className="w-5 h-5"/> Connect</>}
                </button>
                {connError && <p className="text-rose-500 font-medium text-center bg-rose-500/10 py-3 rounded-2xl">{connError}</p>}
              </div>
           </div>
        </div>

        {/* Main Interface Area */}
        <div className={`space-y-16 transition-all duration-700 ${isConnected ? 'opacity-100 scale-100' : 'opacity-30 scale-95 pointer-events-none grayscale'}`}>
          
          {/* Source Selector */}
          <section>
            <div className="flex items-center justify-between mb-6 px-4">
              <h3 className="text-2xl font-medium text-white flex items-center gap-3">
                <Radio className="w-6 h-6 text-neutral-400" /> Target Media Source
              </h3>
              <button onClick={fetchSources} className="p-3 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-full text-white transition-all" title="Refresh Sources">
                <RefreshCw className="w-5 h-5" />
              </button>
            </div>
            
            {sources.length > 0 ? (
              <div className="relative group">
                <select
                  value={selectedSource}
                  onChange={(e) => setSelectedSource(e.target.value)}
                  className="w-full appearance-none bg-black border border-neutral-800 hover:border-neutral-600 rounded-full px-8 py-6 text-xl font-medium text-white focus:border-white focus:outline-none transition-all cursor-pointer shadow-sm"
                >
                  {sources.map((s) => (
                    <option key={s.name} value={s.name} className="bg-neutral-900 py-2">{s.name}</option>
                  ))}
                </select>
                <div className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 text-neutral-500 group-hover:text-white transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                </div>
              </div>
            ) : (
               <div className="p-8 text-center text-neutral-500 border-2 border-dashed border-neutral-800 rounded-[2rem] font-medium">
                 {isConnected ? 'No compatible media sources found (ffmpeg, vlc, browser).' : 'Connect to OBS to see sources.'}
               </div>
            )}
          </section>

          {/* Quick Switch Links */}
          <section>
            <h3 className="text-2xl font-medium text-white mb-8 px-4 flex items-center gap-3">
              <Play className="w-6 h-6 text-neutral-400" /> Quick Switch
            </h3>
            
            <div className="flex flex-wrap gap-4">
              {links.map(link => {
                const isActive = currentSourceUrl === link.url;
                return (
                  <button
                    key={link.id}
                    onClick={() => switchMedia(link)}
                    disabled={!selectedSource}
                    className={`relative group flex items-center gap-4 pl-6 pr-8 py-5 rounded-full border-2 transition-all duration-200 active:scale-95 disabled:opacity-50 
                      ${isActive 
                        ? 'bg-neutral-900 border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.2)]' 
                        : 'bg-black border-neutral-800 hover:border-white hover:bg-neutral-900'}`}
                  >
                    {/* Active Indicator Dot */}
                    <div className={`w-3 h-3 rounded-full transition-all duration-500 ${isActive ? 'bg-emerald-500 shadow-[0_0_10px_#10b981]' : 'bg-neutral-800 group-hover:bg-neutral-600'}`} />
                    
                    <div className="text-left">
                      <div className={`text-lg font-medium leading-none mb-1 ${isActive ? 'text-white' : 'text-neutral-200 group-hover:text-white'}`}>
                        {link.name}
                      </div>
                    </div>
                  </button>
                );
              })}
              {links.length === 0 && (
                <p className="text-neutral-500 px-4 py-2">No links yet. Add them below.</p>
              )}
            </div>
          </section>

          {/* Link Manager */}
          <section className="bg-neutral-900/30 border border-neutral-800 rounded-[3rem] p-8 md:p-12">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-12 gap-6">
              <h3 className="text-2xl font-medium text-white flex items-center gap-3">
                <LinkIcon className="w-6 h-6 text-neutral-400" /> Link Manager
              </h3>
              <div className="flex gap-4">
                <button onClick={handleExport} className="flex items-center gap-2 px-6 py-3 bg-black border border-neutral-800 hover:border-white rounded-full text-sm font-bold uppercase tracking-wider transition-all">
                  <Download className="w-4 h-4" /> Export
                </button>
                <label className="flex items-center gap-2 px-6 py-3 bg-black border border-neutral-800 hover:border-white rounded-full text-sm font-bold uppercase tracking-wider transition-all cursor-pointer">
                  <Upload className="w-4 h-4" /> Import
                  <input type="file" accept=".json" onChange={handleImport} className="hidden" />
                </label>
              </div>
            </div>

            {/* Add/Edit Inputs */}
            <div className="bg-black p-3 rounded-[2.5rem] border border-neutral-800 mb-8 flex flex-col md:flex-row gap-2 md:items-center">
              <div className="flex-1">
                <input 
                   type="text" 
                   placeholder="Link Name"
                   value={tempName}
                   onChange={e => setTempName(e.target.value)}
                   className="w-full bg-transparent border-none px-6 py-4 text-white placeholder:text-neutral-600 focus:ring-0 focus:outline-none text-lg"
                />
              </div>
              <div className="hidden md:block w-px h-10 bg-neutral-800 mx-2"></div>
              <div className="flex-[2]">
                <input 
                   type="text" 
                   placeholder="URL (rtmp://, http://, C:\\path\\...)"
                   value={tempUrl}
                   onChange={e => setTempUrl(e.target.value)}
                   className="w-full bg-transparent border-none px-6 py-4 text-white placeholder:text-neutral-600 focus:ring-0 focus:outline-none text-lg"
                />
              </div>
              <div className="p-2 flex justify-end">
                {editingLinkId ? (
                   <div className="flex gap-2">
                     <button onClick={saveEditing} className="p-4 bg-white text-black rounded-full hover:scale-105 transition-transform" title="Save Changes">
                       <Check className="w-6 h-6" />
                     </button>
                     <button onClick={() => { setEditingLinkId(null); setTempName(''); setTempUrl(''); }} className="p-4 bg-neutral-800 text-white rounded-full hover:bg-neutral-700 transition-colors" title="Cancel">
                       <X className="w-6 h-6" />
                     </button>
                   </div>
                ) : (
                   <button 
                     onClick={handleAddLink} 
                     disabled={!tempName.trim() || !tempUrl.trim()}
                     className="p-4 bg-white text-black rounded-full hover:bg-neutral-200 disabled:bg-neutral-800 disabled:text-neutral-600 transition-all disabled:hover:transform-none hover:rotate-90 duration-300"
                     title="Add Link"
                   >
                     <Plus className="w-6 h-6" />
                   </button>
                )}
              </div>
            </div>

            {/* Links List */}
            <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
              {links.map(link => {
                 const isActive = currentSourceUrl === link.url;
                 return (
                  <div key={link.id} className={`group flex items-center justify-between p-4 pl-8 bg-black/50 border rounded-[2rem] transition-all hover:border-neutral-600 ${isActive ? 'border-emerald-500 bg-neutral-900/30' : 'border-neutral-800'}`}>
                    <div className="min-w-0 flex-1 mr-6">
                      <div className="flex items-center gap-3 mb-1">
                        <span className={`text-lg font-medium ${isActive ? 'text-emerald-400' : 'text-white'}`}>{link.name}</span>
                        {isActive && <Circle className="w-2.5 h-2.5 fill-emerald-500 text-emerald-500 animate-pulse" />}
                      </div>
                      <div className="text-neutral-500 text-sm truncate font-mono">{link.url}</div>
                    </div>
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      <button onClick={() => startEditing(link)} className="p-3 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-full transition-colors">
                        <Edit2 className="w-5 h-5" />
                      </button>
                      <button onClick={() => handleDeleteLink(link.id)} className="p-3 text-neutral-400 hover:text-rose-500 hover:bg-rose-950 rounded-full transition-colors">
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                 );
              })}
            </div>
          </section>

        </div>
      </main>

      {/* Custom Scrollbar for pure black theme */}
      
       
    
    </div>
  );
}
