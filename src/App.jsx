import { useState, useEffect, useCallback, useRef } from "react";

const SUPABASE_URL = "https://zbvxrwftgtiwtlqzgztv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpidnhyd2Z0Z3Rpd3RscXpnenR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3NzU4NDgsImV4cCI6MjA5NjM1MTg0OH0.uuyQAAeJxtlf6FzjRMEUvdfTy5VD3j3mfy8G_lXx_ag";

// ─── AUTH ─────────────────────────────────────────────────────────────────────
async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || data.msg || JSON.stringify(data));
  return data;
}
async function signOut(token) {
  await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
    method: "POST",
    headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}` },
  });
}
async function getProfile(userId, token) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=*`, {
    headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}` },
  });
  const data = await res.json();
  return data[0] || null;
}

// ─── DB ───────────────────────────────────────────────────────────────────────
function makeDb(token) {
  async function sbFetch(table, method = "GET", body = null, query = "") {
    const headers = {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Prefer": method === "POST" ? "return=representation" : "",
    };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      method, headers, body: body ? JSON.stringify(body) : null,
    });
    if (!res.ok) { const e = await res.text(); throw new Error(e); }
    if (method === "DELETE" || res.status === 204) return null;
    return res.json();
  }
  return {
    list: (table, query = "select=*&order=created_at.desc") => sbFetch(table, "GET", null, query),
    insert: (table, data) => sbFetch(table, "POST", data),
    update: (table, id, data) => sbFetch(table, "PATCH", data, `id=eq.${id}`),
    delete: (table, id) => sbFetch(table, "DELETE", null, `id=eq.${id}`),
  };
}

// ─── STORAGE ──────────────────────────────────────────────────────────────────
async function uploadFile(token, file, relatedId, relatedType, db) {
  const ext = file.name.split(".").pop();
  const path = `${relatedType}/${relatedId}/${Date.now()}.${ext}`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/job-files/${path}`, {
    method: "POST",
    headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}`, "Content-Type": file.type },
    body: file,
  });
  if (!res.ok) { const e = await res.text(); throw new Error(e); }
  const url = `${SUPABASE_URL}/storage/v1/object/public/job-files/${path}`;
  await db.insert("files", { name: file.name, url, type: file.type, related_id: relatedId, related_type: relatedType });
  return url;
}

// ─── UI HELPERS ───────────────────────────────────────────────────────────────
const statusColors = {
  New: "bg-blue-100 text-blue-700", Contacted: "bg-yellow-100 text-yellow-700",
  Qualified: "bg-green-100 text-green-700", Lost: "bg-red-100 text-red-700",
  Pending: "bg-gray-100 text-gray-600", Scheduled: "bg-blue-100 text-blue-700",
  "In Progress": "bg-orange-100 text-orange-700", Completed: "bg-green-100 text-green-700",
  Cancelled: "bg-red-100 text-red-700", Draft: "bg-gray-100 text-gray-600",
  Sent: "bg-blue-100 text-blue-700", Approved: "bg-green-100 text-green-700",
  Declined: "bg-red-100 text-red-700", Paid: "bg-emerald-100 text-emerald-700",
  Done: "bg-green-100 text-green-700", High: "bg-red-100 text-red-700",
  Medium: "bg-yellow-100 text-yellow-700", Low: "bg-gray-100 text-gray-600",
  admin: "bg-amber-100 text-amber-700", member: "bg-gray-100 text-gray-600",
};
const priorityDot = { High: "bg-red-500", Medium: "bg-yellow-400", Low: "bg-gray-400" };

function Badge({ label }) {
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusColors[label] || "bg-gray-100 text-gray-600"}`}>{label}</span>;
}
function Spinner() {
  return <div className="flex items-center justify-center py-16"><div className="w-8 h-8 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin"></div></div>;
}
function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${wide ? "max-w-3xl" : "max-w-lg"} overflow-hidden max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
function Field({ label, value, onChange, type = "text", options, disabled }) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {options ? (
        <select value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white disabled:opacity-50">
          {options.map(o => <option key={o}>{o}</option>)}
        </select>
      ) : type === "textarea" ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} rows={3}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
      ) : (
        <input type={type} value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-50" />
      )}
    </div>
  );
}

// ─── FILE PANEL ───────────────────────────────────────────────────────────────
function FilePanel({ relatedId, relatedType, token, db }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const fileRef = useRef();

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try { setFiles(await db.list("files", `select=*&related_id=eq.${relatedId}&order=created_at.desc`)); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [db, relatedId]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  const handleUpload = async (e) => {
    const selected = Array.from(e.target.files);
    if (!selected.length) return;
    setUploading(true);
    try {
      for (const file of selected) await uploadFile(token, file, relatedId, relatedType, db);
      await loadFiles();
    } catch (err) { alert("Upload failed: " + err.message); }
    finally { setUploading(false); }
  };

  const deleteFile = async (file) => {
    if (!confirm("Delete this file?")) return;
    try { await db.delete("files", file.id); setFiles(files.filter(f => f.id !== file.id)); }
    catch (e) { alert("Delete failed: " + e.message); }
  };

  const isImage = (f) => f.type?.startsWith("image/");
  const photos = files.filter(isImage);
  const docs = files.filter(f => !isImage(f));

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => fileRef.current.click()} disabled={uploading}
          className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-xl text-sm flex items-center gap-2">
          {uploading ? "Uploading..." : "📎 Upload Files"}
        </button>
        <span className="text-xs text-gray-400">Photos, PDFs, contracts...</span>
        <input ref={fileRef} type="file" multiple className="hidden" onChange={handleUpload} accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" />
      </div>
      {loading ? <Spinner /> : (
        <>
          {photos.length > 0 && (
            <div className="mb-6">
              <h4 className="text-sm font-bold text-gray-700 mb-3">📸 Photos ({photos.length})</h4>
              <div className="grid grid-cols-3 gap-2">
                {photos.map(f => (
                  <div key={f.id} className="relative group rounded-xl overflow-hidden aspect-square bg-gray-100">
                    <img src={f.url} alt={f.name} className="w-full h-full object-cover cursor-pointer" onClick={() => setLightbox(f)} />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                      <button onClick={() => setLightbox(f)} className="bg-white rounded-full p-1.5 text-xs">🔍</button>
                      <button onClick={() => deleteFile(f)} className="bg-white rounded-full p-1.5 text-red-500 text-xs">🗑</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {docs.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-bold text-gray-700 mb-3">📄 Documents ({docs.length})</h4>
              <div className="space-y-2">
                {docs.map(f => (
                  <div key={f.id} className="flex items-center gap-3 bg-gray-50 rounded-xl p-3">
                    <span className="text-2xl">📄</span>
                    <div className="flex-1 min-w-0"><p className="text-sm font-medium text-gray-800 truncate">{f.name}</p><p className="text-xs text-gray-400">{new Date(f.created_at).toLocaleDateString()}</p></div>
                    <a href={f.url} target="_blank" rel="noreferrer" className="text-xs bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-100">Open</a>
                    <button onClick={() => deleteFile(f)} className="text-xs text-red-400 hover:text-red-600">✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {files.length === 0 && (
            <div className="text-center py-10 border-2 border-dashed border-gray-200 rounded-2xl">
              <p className="text-gray-400 text-sm">No files yet</p>
              <p className="text-gray-300 text-xs mt-1">Upload photos, contracts, or documents</p>
            </div>
          )}
        </>
      )}
      {lightbox && (
        <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <div className="relative max-w-4xl w-full" onClick={e => e.stopPropagation()}>
            <img src={lightbox.url} alt={lightbox.name} className="w-full max-h-[80vh] object-contain rounded-xl" />
            <div className="flex items-center justify-between mt-3">
              <p className="text-white text-sm">{lightbox.name}</p>
              <div className="flex gap-2">
                <a href={lightbox.url} target="_blank" rel="noreferrer" className="bg-white/20 text-white px-3 py-1.5 rounded-lg text-sm">Download</a>
                <button onClick={() => setLightbox(null)} className="bg-white/20 text-white px-3 py-1.5 rounded-lg text-sm">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── DETAIL MODAL ─────────────────────────────────────────────────────────────
function DetailModal({ item, type, token, db, onClose, onUpdate }) {
  const [activeTab, setActiveTab] = useState("details");
  const [notes, setNotes] = useState(item.notes || "");
  const [saving, setSaving] = useState(false);

  const saveNotes = async () => {
    setSaving(true);
    try {
      await db.update(type === "lead" ? "leads" : "jobs", item.id, { notes });
      onUpdate({ ...item, notes });
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={item.name || item.title} onClose={onClose} wide>
      <div className="flex gap-1 mb-5 bg-gray-100 rounded-xl p-1">
        {["details", "photos", "documents", "notes"].map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold capitalize transition-colors ${activeTab === t ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
            {t === "photos" ? "📸 Photos" : t === "documents" ? "📄 Docs" : t === "notes" ? "📝 Notes" : "ℹ️ Details"}
          </button>
        ))}
      </div>
      {activeTab === "details" && (
        <div className="space-y-3">
          {type === "lead" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Email</p><p className="text-sm font-medium truncate">{item.email || "—"}</p></div>
                <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Phone</p><p className="text-sm font-medium">{item.phone || "—"}</p></div>
                <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Source</p><p className="text-sm font-medium">{item.source || "—"}</p></div>
                <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Status</p><Badge label={item.status} /></div>
              </div>
              {item.assigned_name && <div className="bg-amber-50 border border-amber-100 rounded-xl p-3"><p className="text-xs text-amber-600">Assigned To</p><p className="text-sm font-semibold text-amber-800">👤 {item.assigned_name}</p></div>}
              {item.address && <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Address</p><p className="text-sm font-medium">{item.address}</p></div>}
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Customer</p><p className="text-sm font-medium">{item.customer || "—"}</p></div>
                <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Type</p><p className="text-sm font-medium">{item.type || "—"}</p></div>
                <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Value</p><p className="text-sm font-medium">${Number(item.value || 0).toLocaleString()}</p></div>
                <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Status</p><Badge label={item.status} /></div>
              </div>
              {item.address && <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Address</p><p className="text-sm font-medium">{item.address}</p></div>}
              {item.start_date && <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Start Date</p><p className="text-sm font-medium">{item.start_date}</p></div>}
            </>
          )}
        </div>
      )}
      {activeTab === "photos" && <FilePanel relatedId={item.id} relatedType={`${type}-photos`} token={token} db={db} />}
      {activeTab === "documents" && <FilePanel relatedId={item.id} relatedType={`${type}-docs`} token={token} db={db} />}
      {activeTab === "notes" && (
        <div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={8} placeholder="Add notes, comments, or activity..."
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none mb-3" />
          <button onClick={saveNotes} disabled={saving} className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm">
            {saving ? "Saving..." : "Save Notes"}
          </button>
        </div>
      )}
    </Modal>
  );
}

// ─── LEADS ───────────────────────────────────────────────────────────────────
const LEAD_STATUSES = ["New", "Contacted", "Qualified", "Lost"];
function LeadsView({ db, token, profile }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [teamMembers, setTeamMembers] = useState([]);
  const [form, setForm] = useState({ name: "", phone: "", email: "", address: "", source: "Referral", status: "New", notes: "", assigned_to: "", assigned_name: "" });
  const isAdmin = profile?.role === "admin";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [leadsData, members] = await Promise.all([
        db.list("leads"),
        db.list("profiles", "select=*&order=full_name.asc"),
      ]);
      setLeads(leadsData);
      setTeamMembers(members);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [db]);
  useEffect(() => { load(); }, [load]);

  const filtered = leads.filter(l =>
    l.name?.toLowerCase().includes(search.toLowerCase()) ||
    l.email?.toLowerCase().includes(search.toLowerCase())
  );

  const addLead = async () => {
    if (!form.name) return;
    setSaving(true);
    try {
      const payload = { ...form };
      if (!payload.assigned_to) { delete payload.assigned_to; delete payload.assigned_name; }
      const [created] = await db.insert("leads", payload);
      setLeads([created, ...leads]);
      setForm({ name: "", phone: "", email: "", address: "", source: "Referral", status: "New", notes: "", assigned_to: "", assigned_name: "" });
      setShowModal(false);
    } catch (e) { alert("Error: " + e.message); }
    finally { setSaving(false); }
  };

  const assignLead = async (lead, memberId) => {
    const member = teamMembers.find(m => m.id === memberId);
    const update = { assigned_to: memberId || null, assigned_name: member?.full_name || member?.email || null };
    setLeads(leads.map(l => l.id === lead.id ? { ...l, ...update } : l));
    try { await db.update("leads", lead.id, update); } catch { load(); }
  };

  const updateStatus = async (id, status) => {
    setLeads(leads.map(l => l.id === id ? { ...l, status } : l));
    try { await db.update("leads", id, { status }); } catch { load(); }
  };

  const deleteLead = async (id) => {
    if (!confirm("Delete this lead?")) return;
    setLeads(leads.filter(l => l.id !== id));
    try { await db.delete("leads", id); } catch { load(); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Leads & Contacts</h2>
          <p className="text-sm text-gray-500 mt-0.5">{leads.length} {isAdmin ? "total" : "assigned to you"}</p>
        </div>
        <button onClick={() => setShowModal(true)} className="bg-amber-500 hover:bg-amber-600 text-white font-semibold px-4 py-2 rounded-xl text-sm">+ Add Lead</button>
      </div>
      <input placeholder="Search leads..." value={search} onChange={e => setSearch(e.target.value)}
        className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white shadow-sm mb-4" />
      {loading ? <Spinner /> : (
        <div className="grid gap-3">
          {filtered.length === 0 && <p className="text-center text-gray-400 py-12">No leads yet</p>}
          {filtered.map(lead => (
            <div key={lead.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 hover:shadow-md transition-shadow">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 font-bold flex-shrink-0">{lead.name?.[0] || "?"}</div>
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setSelected(lead)}>
                  <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-gray-900">{lead.name}</span><Badge label={lead.status} /></div>
                  <p className="text-sm text-gray-500 mt-0.5">{lead.email}{lead.phone ? ` · ${lead.phone}` : ""}</p>
                  {lead.address && <p className="text-xs text-gray-400 mt-0.5 truncate">{lead.address}</p>}
                  {lead.assigned_name && <p className="text-xs mt-1 text-amber-600 font-medium">👤 {lead.assigned_name}</p>}
                </div>
                <div className="flex flex-col gap-1.5 flex-shrink-0 items-end">
                  <select value={lead.status} onChange={e => updateStatus(lead.id, e.target.value)}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none">
                    {LEAD_STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                  {isAdmin && (
                    <select value={lead.assigned_to || ""} onChange={e => assignLead(lead, e.target.value)}
                      className="text-xs border border-amber-200 rounded-lg px-2 py-1 bg-amber-50 text-amber-700 focus:outline-none max-w-[130px]">
                      <option value="">Unassigned</option>
                      {teamMembers.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
                    </select>
                  )}
                  <div className="flex gap-2">
                    <button onClick={() => setSelected(lead)} className="text-xs text-blue-400 hover:text-blue-600">View</button>
                    {isAdmin && <button onClick={() => deleteLead(lead.id)} className="text-xs text-red-400 hover:text-red-600">Delete</button>}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {showModal && (
        <Modal title="Add New Lead" onClose={() => setShowModal(false)}>
          <Field label="Full Name *" value={form.name} onChange={v => setForm({ ...form, name: v })} />
          <Field label="Phone" value={form.phone} onChange={v => setForm({ ...form, phone: v })} />
          <Field label="Email" value={form.email} onChange={v => setForm({ ...form, email: v })} />
          <Field label="Address" value={form.address} onChange={v => setForm({ ...form, address: v })} />
          <Field label="Source" value={form.source} onChange={v => setForm({ ...form, source: v })} options={["Referral", "Website", "Door Knock", "Social Media", "Other"]} />
          <Field label="Status" value={form.status} onChange={v => setForm({ ...form, status: v })} options={LEAD_STATUSES} />
          {isAdmin && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Assign To Team Member</label>
              <select value={form.assigned_to} onChange={e => {
                const member = teamMembers.find(m => m.id === e.target.value);
                setForm({ ...form, assigned_to: e.target.value, assigned_name: member?.full_name || member?.email || "" });
              }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white">
                <option value="">Unassigned</option>
                {teamMembers.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
              </select>
            </div>
          )}
          <Field label="Notes" value={form.notes} onChange={v => setForm({ ...form, notes: v })} type="textarea" />
          <button onClick={addLead} disabled={saving} className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm">{saving ? "Saving..." : "Save Lead"}</button>
        </Modal>
      )}
      {selected && (
        <DetailModal item={selected} type="lead" token={token} db={db}
          onClose={() => setSelected(null)}
          onUpdate={updated => { setLeads(leads.map(l => l.id === updated.id ? updated : l)); setSelected(updated); }} />
      )}
    </div>
  );
}

// ─── JOBS ─────────────────────────────────────────────────────────────────────
const JOB_STATUSES = ["Pending", "Scheduled", "In Progress", "Completed", "Cancelled"];
function JobsView({ db, token }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("All");
  const [form, setForm] = useState({ title: "", customer: "", address: "", status: "Pending", type: "Roofing", start_date: "", value: "", notes: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try { setJobs(await db.list("jobs")); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [db]);
  useEffect(() => { load(); }, [load]);

  const filtered = filter === "All" ? jobs : jobs.filter(j => j.status === filter);
  const typeIcon = { Roofing: "🏠", Remodeling: "🔨", Siding: "🪵", Windows: "🪟", Other: "🔧" };

  const addJob = async () => {
    if (!form.title) return;
    setSaving(true);
    try {
      const [created] = await db.insert("jobs", { ...form, value: parseFloat(form.value) || 0 });
      setJobs([created, ...jobs]);
      setForm({ title: "", customer: "", address: "", status: "Pending", type: "Roofing", start_date: "", value: "", notes: "" });
      setShowModal(false);
    } catch (e) { alert("Error: " + e.message); }
    finally { setSaving(false); }
  };

  const updateStatus = async (id, status) => {
    setJobs(jobs.map(j => j.id === id ? { ...j, status } : j));
    try { await db.update("jobs", id, { status }); } catch { load(); }
  };

  const deleteJob = async (id) => {
    if (!confirm("Delete this job?")) return;
    setJobs(jobs.filter(j => j.id !== id));
    try { await db.delete("jobs", id); } catch { load(); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div><h2 className="text-2xl font-bold text-gray-900">Jobs & Projects</h2><p className="text-sm text-gray-500 mt-0.5">{jobs.length} total</p></div>
        <button onClick={() => setShowModal(true)} className="bg-amber-500 hover:bg-amber-600 text-white font-semibold px-4 py-2 rounded-xl text-sm">+ New Job</button>
      </div>
      <div className="flex gap-2 mb-5 flex-wrap">
        {["All", ...JOB_STATUSES].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filter === s ? "bg-amber-500 text-white" : "bg-white border border-gray-200 text-gray-600 hover:border-amber-400"}`}>{s}</button>
        ))}
      </div>
      {loading ? <Spinner /> : (
        <div className="grid gap-3">
          {filtered.length === 0 && <p className="text-center text-gray-400 py-12">No jobs yet</p>}
          {filtered.map(job => (
            <div key={job.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 hover:shadow-md transition-shadow">
              <div className="flex items-start gap-3">
                <span className="text-2xl flex-shrink-0">{typeIcon[job.type] || "🔧"}</span>
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setSelected(job)}>
                  <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-gray-900">{job.title}</span><Badge label={job.status} /></div>
                  <p className="text-sm text-gray-500 mt-0.5">{job.customer}{job.address ? ` · ${job.address}` : ""}</p>
                  <p className="text-sm font-bold text-gray-900 mt-0.5">${Number(job.value || 0).toLocaleString()}</p>
                </div>
                <div className="flex flex-col gap-1.5 flex-shrink-0 items-end">
                  <select value={job.status} onChange={e => updateStatus(job.id, e.target.value)}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none">
                    {JOB_STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <button onClick={() => setSelected(job)} className="text-xs text-blue-400 hover:text-blue-600">View</button>
                    <button onClick={() => deleteJob(job.id)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {showModal && (
        <Modal title="Add New Job" onClose={() => setShowModal(false)}>
          <Field label="Job Title *" value={form.title} onChange={v => setForm({ ...form, title: v })} />
          <Field label="Customer Name" value={form.customer} onChange={v => setForm({ ...form, customer: v })} />
          <Field label="Address" value={form.address} onChange={v => setForm({ ...form, address: v })} />
          <Field label="Job Type" value={form.type} onChange={v => setForm({ ...form, type: v })} options={["Roofing", "Remodeling", "Siding", "Windows", "Other"]} />
          <Field label="Status" value={form.status} onChange={v => setForm({ ...form, status: v })} options={JOB_STATUSES} />
          <Field label="Start Date" value={form.start_date} onChange={v => setForm({ ...form, start_date: v })} type="date" />
          <Field label="Contract Value ($)" value={form.value} onChange={v => setForm({ ...form, value: v })} type="number" />
          <Field label="Notes" value={form.notes} onChange={v => setForm({ ...form, notes: v })} type="textarea" />
          <button onClick={addJob} disabled={saving} className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm">{saving ? "Saving..." : "Save Job"}</button>
        </Modal>
      )}
      {selected && (
        <DetailModal item={selected} type="job" token={token} db={db}
          onClose={() => setSelected(null)}
          onUpdate={updated => { setJobs(jobs.map(j => j.id === updated.id ? updated : j)); setSelected(updated); }} />
      )}
    </div>
  );
}

// ─── ESTIMATES ────────────────────────────────────────────────────────────────
const EST_STATUSES = ["Draft", "Sent", "Approved", "Declined"];
function EstimatesView({ db }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("Estimates");
  const [form, setForm] = useState({ number: "", customer: "", job: "", date: "", amount: "", status: "Draft", type: "Estimate" });

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await db.list("estimates")); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [db]);
  useEffect(() => { load(); }, [load]);

  const filtered = tab === "Estimates" ? items.filter(i => i.type !== "Invoice") : items.filter(i => i.type === "Invoice");
  const totalApproved = items.filter(i => i.status === "Approved").reduce((s, i) => s + Number(i.amount || 0), 0);
  const totalPaid = items.filter(i => i.status === "Paid").reduce((s, i) => s + Number(i.amount || 0), 0);

  const addItem = async () => {
    if (!form.number) return;
    setSaving(true);
    try {
      const [created] = await db.insert("estimates", { ...form, amount: parseFloat(form.amount) || 0 });
      setItems([created, ...items]);
      setForm({ number: "", customer: "", job: "", date: "", amount: "", status: "Draft", type: form.type });
      setShowModal(false);
    } catch (e) { alert("Error: " + e.message); }
    finally { setSaving(false); }
  };

  const deleteItem = async (id) => {
    if (!confirm("Delete?")) return;
    setItems(items.filter(i => i.id !== id));
    try { await db.delete("estimates", id); } catch { load(); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div><h2 className="text-2xl font-bold text-gray-900">Estimates & Invoices</h2><p className="text-sm text-gray-500 mt-0.5">{items.length} documents</p></div>
        <button onClick={() => setShowModal(true)} className="bg-amber-500 hover:bg-amber-600 text-white font-semibold px-4 py-2 rounded-xl text-sm">+ New</button>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-green-50 border border-green-100 rounded-2xl p-4"><p className="text-xs text-green-600 font-medium uppercase">Approved</p><p className="text-2xl font-bold text-green-700 mt-1">${totalApproved.toLocaleString()}</p></div>
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4"><p className="text-xs text-blue-600 font-medium uppercase">Paid</p><p className="text-2xl font-bold text-blue-700 mt-1">${totalPaid.toLocaleString()}</p></div>
      </div>
      <div className="flex gap-2 mb-5">
        {["Estimates", "Invoices"].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t ? "bg-amber-500 text-white" : "bg-white border border-gray-200 text-gray-600"}`}>{t}</button>
        ))}
      </div>
      {loading ? <Spinner /> : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Number</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Customer</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Amount</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th className="px-4 py-3"></th>
            </tr></thead>
            <tbody>
              {filtered.map(item => (
                <tr key={item.id} className="border-b border-gray-50 hover:bg-amber-50/30">
                  <td className="px-4 py-3 font-mono text-gray-700 font-medium">{item.number}</td>
                  <td className="px-4 py-3 text-gray-700">{item.customer}</td>
                  <td className="px-4 py-3 text-right font-semibold">${Number(item.amount || 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-center"><Badge label={item.status} /></td>
                  <td className="px-4 py-3 text-center"><button onClick={() => deleteItem(item.id)} className="text-xs text-red-400 hover:text-red-600">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="text-center py-12 text-gray-400">No {tab.toLowerCase()} yet</div>}
        </div>
      )}
      {showModal && (
        <Modal title={`New ${form.type}`} onClose={() => setShowModal(false)}>
          <Field label="Type" value={form.type} onChange={v => setForm({ ...form, type: v })} options={["Estimate", "Invoice"]} />
          <Field label="Number *" value={form.number} onChange={v => setForm({ ...form, number: v })} />
          <Field label="Customer" value={form.customer} onChange={v => setForm({ ...form, customer: v })} />
          <Field label="Related Job" value={form.job} onChange={v => setForm({ ...form, job: v })} />
          <Field label="Date" value={form.date} onChange={v => setForm({ ...form, date: v })} type="date" />
          <Field label="Amount ($)" value={form.amount} onChange={v => setForm({ ...form, amount: v })} type="number" />
          <Field label="Status" value={form.status} onChange={v => setForm({ ...form, status: v })} options={form.type === "Invoice" ? ["Draft", "Sent", "Paid"] : EST_STATUSES} />
          <button onClick={addItem} disabled={saving} className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm">{saving ? "Saving..." : `Save ${form.type}`}</button>
        </Modal>
      )}
    </div>
  );
}

// ─── TASKS ────────────────────────────────────────────────────────────────────
const TASK_PRIORITIES = ["Low", "Medium", "High"];
function TasksView({ db }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("Pending");
  const [form, setForm] = useState({ title: "", due: "", priority: "Medium", assigned: "", related: "", status: "Pending" });

  const load = useCallback(async () => {
    setLoading(true);
    try { setTasks(await db.list("tasks")); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [db]);
  useEffect(() => { load(); }, [load]);

  const filtered = tasks.filter(t => t.status === filter);
  const pendingCount = tasks.filter(t => t.status === "Pending").length;
  const doneCount = tasks.filter(t => t.status === "Done").length;

  const addTask = async () => {
    if (!form.title) return;
    setSaving(true);
    try {
      const [created] = await db.insert("tasks", form);
      setTasks([created, ...tasks]);
      setForm({ title: "", due: "", priority: "Medium", assigned: "", related: "", status: "Pending" });
      setShowModal(false);
    } catch (e) { alert("Error: " + e.message); }
    finally { setSaving(false); }
  };

  const toggleDone = async (task) => {
    const newStatus = task.status === "Done" ? "Pending" : "Done";
    setTasks(tasks.map(t => t.id === task.id ? { ...t, status: newStatus } : t));
    try { await db.update("tasks", task.id, { status: newStatus }); } catch { load(); }
  };

  const deleteTask = async (id) => {
    if (!confirm("Delete this task?")) return;
    setTasks(tasks.filter(t => t.id !== id));
    try { await db.delete("tasks", id); } catch { load(); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div><h2 className="text-2xl font-bold text-gray-900">Tasks & Calendar</h2><p className="text-sm text-gray-500 mt-0.5">{pendingCount} pending · {doneCount} done</p></div>
        <button onClick={() => setShowModal(true)} className="bg-amber-500 hover:bg-amber-600 text-white font-semibold px-4 py-2 rounded-xl text-sm">+ Add Task</button>
      </div>
      <div className="flex gap-2 mb-5">
        {["Pending", "Done"].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${filter === s ? "bg-amber-500 text-white" : "bg-white border border-gray-200 text-gray-600"}`}>
            {s} ({s === "Pending" ? pendingCount : doneCount})
          </button>
        ))}
      </div>
      {loading ? <Spinner /> : (
        <div className="grid gap-3">
          {filtered.length === 0 && <p className="text-center text-gray-400 py-12">No {filter.toLowerCase()} tasks</p>}
          {filtered.map(task => (
            <div key={task.id} className={`bg-white rounded-2xl border shadow-sm p-4 flex items-start gap-3 hover:shadow-md transition-all ${task.status === "Done" ? "opacity-60" : ""} border-gray-100`}>
              <button onClick={() => toggleDone(task)}
                className={`mt-0.5 w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${task.status === "Done" ? "bg-green-500 border-green-500" : "border-gray-300 hover:border-amber-400"}`}>
                {task.status === "Done" && <span className="text-white text-xs">✓</span>}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`font-medium text-gray-900 ${task.status === "Done" ? "line-through text-gray-400" : ""}`}>{task.title}</span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${statusColors[task.priority]}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${priorityDot[task.priority]}`}></span>{task.priority}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 flex-wrap">
                  {task.due && <span>📅 {task.due}</span>}
                  {task.assigned && <span>👤 {task.assigned}</span>}
                  {task.related && <span>🔗 {task.related}</span>}
                </div>
              </div>
              <button onClick={() => deleteTask(task.id)} className="text-xs text-red-400 hover:text-red-600 flex-shrink-0">✕</button>
            </div>
          ))}
        </div>
      )}
      {showModal && (
        <Modal title="Add New Task" onClose={() => setShowModal(false)}>
          <Field label="Task Title *" value={form.title} onChange={v => setForm({ ...form, title: v })} />
          <Field label="Due Date" value={form.due} onChange={v => setForm({ ...form, due: v })} type="date" />
          <Field label="Priority" value={form.priority} onChange={v => setForm({ ...form, priority: v })} options={TASK_PRIORITIES} />
          <Field label="Assigned To" value={form.assigned} onChange={v => setForm({ ...form, assigned: v })} />
          <Field label="Related Job / Lead" value={form.related} onChange={v => setForm({ ...form, related: v })} />
          <button onClick={addTask} disabled={saving} className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm">{saving ? "Saving..." : "Save Task"}</button>
        </Modal>
      )}
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({ db, setTab }) {
  const [stats, setStats] = useState({ leads: 0, jobs: 0, pipeline: 0, tasks: 0 });
  const [recentJobs, setRecentJobs] = useState([]);
  const [upcomingTasks, setUpcomingTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [leads, jobs, tasks] = await Promise.all([db.list("leads"), db.list("jobs"), db.list("tasks")]);
        setStats({ leads: leads.length, jobs: jobs.length, pipeline: jobs.reduce((s, j) => s + Number(j.value || 0), 0), tasks: tasks.filter(t => t.status === "Pending").length });
        setRecentJobs(jobs.slice(0, 3));
        setUpcomingTasks(tasks.filter(t => t.status === "Pending").slice(0, 4));
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    }
    load();
  }, [db]);

  const cards = [
    { label: "Active Leads", value: stats.leads, icon: "👥", color: "bg-blue-50 border-blue-100", text: "text-blue-600", tab: "leads" },
    { label: "Open Jobs", value: stats.jobs, icon: "🏗️", color: "bg-orange-50 border-orange-100", text: "text-orange-600", tab: "jobs" },
    { label: "Pipeline", value: `$${stats.pipeline.toLocaleString()}`, icon: "💰", color: "bg-green-50 border-green-100", text: "text-green-600", tab: "estimates" },
    { label: "Tasks Due", value: stats.tasks, icon: "✅", color: "bg-purple-50 border-purple-100", text: "text-purple-600", tab: "tasks" },
  ];

  return (
    <div>
      <div className="mb-6"><h2 className="text-2xl font-bold text-gray-900">Dashboard</h2><p className="text-sm text-gray-500 mt-0.5">Your live business overview</p></div>
      {loading ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 gap-3 mb-6">
            {cards.map(s => (
              <button key={s.label} onClick={() => setTab(s.tab)} className={`${s.color} border rounded-2xl p-4 text-left hover:shadow-md transition-all`}>
                <div className="text-2xl mb-2">{s.icon}</div>
                <p className={`text-2xl font-bold ${s.text}`}>{s.value}</p>
                <p className="text-xs text-gray-500 mt-0.5 font-medium">{s.label}</p>
              </button>
            ))}
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
            <h3 className="font-bold text-gray-900 mb-3">Recent Jobs</h3>
            {recentJobs.length === 0 ? <p className="text-sm text-gray-400">No jobs yet</p> : (
              <div className="space-y-3">
                {recentJobs.map(job => (
                  <div key={job.id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0"><p className="text-sm font-medium text-gray-800 truncate">{job.title}</p><p className="text-xs text-gray-400">{job.customer}</p></div>
                    <div className="flex items-center gap-2 flex-shrink-0"><span className="text-sm font-semibold text-gray-700">${Number(job.value || 0).toLocaleString()}</span><Badge label={job.status} /></div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="font-bold text-gray-900 mb-3">Pending Tasks</h3>
            {upcomingTasks.length === 0 ? <p className="text-sm text-gray-400">No pending tasks</p> : (
              <div className="space-y-2">
                {upcomingTasks.map(task => (
                  <div key={task.id} className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${priorityDot[task.priority]}`}></span>
                    <p className="text-sm text-gray-700 flex-1 truncate">{task.title}</p>
                    {task.due && <span className="text-xs text-gray-400 flex-shrink-0">{task.due}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── ADMIN ────────────────────────────────────────────────────────────────────
function AdminPanel({ db, currentUser }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteName, setInviteName] = useState("");
  const [saving, setSaving] = useState(false);
  const [inviteMsg, setInviteMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try { setUsers(await db.list("profiles", "select=*&order=created_at.desc")); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [db]);
  useEffect(() => { load(); }, [load]);

  const updateRole = async (id, role) => {
    setUsers(users.map(u => u.id === id ? { ...u, role } : u));
    try { await db.update("profiles", id, { role }); } catch { load(); }
  };

  const createUser = async () => {
    if (!inviteEmail || !invitePassword) return;
    setSaving(true); setInviteMsg("");
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: "POST",
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, password: invitePassword, email_confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.msg || "Failed to create user");
      await db.update("profiles", data.id, { role: inviteRole, full_name: inviteName });
      setInviteMsg("✅ User created!");
      setInviteEmail(""); setInvitePassword(""); setInviteName(""); setInviteRole("member");
      load();
    } catch (e) { setInviteMsg("⚠️ " + e.message); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div><h2 className="text-2xl font-bold text-gray-900">Admin Panel</h2><p className="text-sm text-gray-500 mt-0.5">Manage your team</p></div>
        <button onClick={() => setShowInvite(true)} className="bg-amber-500 hover:bg-amber-600 text-white font-semibold px-4 py-2 rounded-xl text-sm">+ Add User</button>
      </div>
      <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 mb-5">
        <p className="text-sm text-amber-800 font-medium">👑 Admin Controls</p>
        <p className="text-xs text-amber-600 mt-0.5">You can see all leads. Team members only see leads assigned to them.</p>
      </div>
      {loading ? <Spinner /> : (
        <div className="grid gap-3">
          {users.map(user => (
            <div key={user.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 font-bold flex-shrink-0">
                {(user.full_name || user.email || "?")[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 truncate">{user.full_name || "—"}</p>
                <p className="text-xs text-gray-400 truncate">{user.email}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {user.id === currentUser.id ? <Badge label={user.role} /> : (
                  <select value={user.role} onChange={e => updateRole(user.id, e.target.value)}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none">
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                  </select>
                )}
                {user.id === currentUser.id && <span className="text-xs text-gray-400">(you)</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      {showInvite && (
        <Modal title="Add New User" onClose={() => { setShowInvite(false); setInviteMsg(""); }}>
          {inviteMsg && <div className={`rounded-xl px-4 py-3 mb-4 text-sm ${inviteMsg.startsWith("✅") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>{inviteMsg}</div>}
          <Field label="Full Name" value={inviteName} onChange={setInviteName} />
          <Field label="Email *" value={inviteEmail} onChange={setInviteEmail} type="email" />
          <Field label="Password *" value={invitePassword} onChange={setInvitePassword} type="password" />
          <Field label="Role" value={inviteRole} onChange={setInviteRole} options={["member", "admin"]} />
          <button onClick={createUser} disabled={saving} className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm">{saving ? "Creating..." : "Create User"}</button>
        </Modal>
      )}
    </div>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    if (!email || !password) { setError("Please enter email and password"); return; }
    setLoading(true); setError("");
    try {
      const session = await signIn(email, password);
      const profile = await getProfile(session.user.id, session.access_token);
      onLogin({ session, profile });
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg"><span className="text-white text-3xl">⚒</span></div>
          <h1 className="text-3xl font-bold text-gray-900">BuildCRM</h1>
          <p className="text-gray-500 mt-1 text-sm">Sign in to your account</p>
        </div>
        <div className="bg-white rounded-2xl shadow-xl p-6">
          {error && <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-4 text-sm text-red-600">⚠️ {error}</div>}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              onKeyDown={e => e.key === "Enter" && handleLogin()} />
          </div>
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              onKeyDown={e => e.key === "Enter" && handleLogin()} />
          </div>
          <button onClick={handleLogin} disabled={loading}
            className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm transition-colors shadow-md">
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────
const NAV = [
  { id: "dashboard", label: "Dashboard", icon: "⊞" },
  { id: "leads", label: "Leads", icon: "👥" },
  { id: "jobs", label: "Jobs", icon: "🏗️" },
  { id: "estimates", label: "Estimates", icon: "📄" },
  { id: "tasks", label: "Tasks", icon: "✅" },
];

export default function App() {
  const [auth, setAuth] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [showUserMenu, setShowUserMenu] = useState(false);

  const db = auth ? makeDb(auth.session.access_token) : null;
  const isAdmin = auth?.profile?.role === "admin";
  const nav = [...NAV, ...(isAdmin ? [{ id: "admin", label: "Admin", icon: "⚙️" }] : [])];

  const handleLogin = ({ session, profile }) => { setAuth({ session, profile }); setTab("dashboard"); };
  const handleLogout = async () => {
    try { await signOut(auth.session.access_token); } catch {}
    setAuth(null); setTab("dashboard"); setShowUserMenu(false);
  };

  if (!auth) return <LoginScreen onLogin={handleLogin} />;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col" style={{ fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>
      <header className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center"><span className="text-white text-sm font-bold">⚒</span></div>
            <span className="font-bold text-gray-900 text-lg tracking-tight">BuildCRM</span>
          </div>
          <div className="relative">
            <button onClick={() => setShowUserMenu(!showUserMenu)} className="flex items-center gap-2">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-semibold text-gray-700">{auth.profile?.full_name || auth.session.user.email}</p>
                <p className="text-xs text-amber-600 font-medium capitalize">{auth.profile?.role || "member"}</p>
              </div>
              <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 font-bold text-sm">
                {(auth.profile?.full_name || auth.session.user.email || "?")[0].toUpperCase()}
              </div>
            </button>
            {showUserMenu && (
              <div className="absolute right-0 top-10 bg-white border border-gray-100 rounded-2xl shadow-xl py-2 w-48 z-50">
                <div className="px-4 py-2 border-b border-gray-50">
                  <p className="text-sm font-semibold text-gray-800 truncate">{auth.profile?.full_name || "User"}</p>
                  <p className="text-xs text-gray-400 truncate">{auth.session.user.email}</p>
                </div>
                {isAdmin && <button onClick={() => { setTab("admin"); setShowUserMenu(false); }} className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-amber-50 flex items-center gap-2">⚙️ Admin Panel</button>}
                <button onClick={handleLogout} className="w-full text-left px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 flex items-center gap-2">🚪 Sign Out</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6">
        {tab === "dashboard" && <Dashboard db={db} setTab={setTab} />}
        {tab === "leads" && <LeadsView db={db} token={auth.session.access_token} profile={auth.profile} />}
        {tab === "jobs" && <JobsView db={db} token={auth.session.access_token} />}
        {tab === "estimates" && <EstimatesView db={db} />}
        {tab === "tasks" && <TasksView db={db} />}
        {tab === "admin" && isAdmin && <AdminPanel db={db} currentUser={auth.profile} />}
      </main>

      <nav className="bg-white border-t border-gray-100 shadow-[0_-1px_8px_rgba(0,0,0,0.06)] sticky bottom-0 z-40">
        <div className="max-w-5xl mx-auto px-2 flex">
          {nav.map(n => (
            <button key={n.id} onClick={() => setTab(n.id)}
              className={`flex-1 flex flex-col items-center py-2.5 gap-0.5 transition-colors ${tab === n.id ? "text-amber-500" : "text-gray-400 hover:text-gray-600"}`}>
              <span className="text-lg leading-none">{n.icon}</span>
              <span className="text-[10px] font-semibold tracking-wide">{n.label}</span>
              {tab === n.id && <span className="w-4 h-0.5 bg-amber-500 rounded-full mt-0.5"></span>}
            </button>
          ))}
        </div>
      </nav>
      {showUserMenu && <div className="fixed inset-0 z-30" onClick={() => setShowUserMenu(false)} />}
    </div>
  );
}
