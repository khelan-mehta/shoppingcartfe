import { useState, useEffect, useCallback, useRef } from "react";

// ─── CONFIG ───
// Change this to your deployed backend URL when on Vercel
const API_BASE = import.meta.env.VITE_API_URL || "";
const CART_ID = "default";
const POLL_INTERVAL = 2000; // Poll cart every 2s for ESP32 updates

// ─── STYLES ───
const globalStyles = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0a0e17;
    --surface: #111827;
    --surface-2: #1a2332;
    --border: #1e2d3d;
    --border-glow: #00e5ff22;
    --text: #e8edf3;
    --text-dim: #6b7f95;
    --accent: #00e5ff;
    --accent-dim: #00e5ff33;
    --green: #10b981;
    --green-dim: #10b98122;
    --red: #ef4444;
    --red-dim: #ef444422;
    --yellow: #f59e0b;
    --mono: 'Space Mono', monospace;
    --sans: 'DM Sans', sans-serif;
  }

  body {
    font-family: var(--sans);
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
  }

  @keyframes slideUp {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  @keyframes scanline {
    0% { transform: translateY(-100%); }
    100% { transform: translateY(400%); }
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes popIn {
    0% { opacity: 0; transform: scale(0.9) translateY(8px); }
    70% { transform: scale(1.02) translateY(-2px); }
    100% { opacity: 1; transform: scale(1) translateY(0); }
  }
`;

// ─── ICONS (inline SVGs) ───
function CartIcon() {
  return (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
    </svg>
  );
}

function ScanIcon() {
  return (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"/>
      <line x1="7" y1="12" x2="17" y2="12"/>
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

function WifiIcon({ connected }) {
  return (
    <svg width="18" height="18" fill="none" stroke={connected ? "var(--green)" : "var(--red)"} strokeWidth="2" viewBox="0 0 24 24">
      <path d="M5 12.55a11 11 0 0114 0"/><path d="M1.42 9a16 16 0 0121.16 0"/><path d="M8.53 16.11a6 6 0 016.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>
    </svg>
  );
}

// ─── API FUNCTIONS ───
async function fetchCart() {
  const res = await fetch(`${API_BASE}/api/cart/${CART_ID}`);
  if (!res.ok) throw new Error("Failed to fetch cart");
  return res.json();
}

async function scanProduct(tagId) {
  const res = await fetch(`${API_BASE}/api/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag_id: tagId, cart_id: CART_ID }),
  });
  if (!res.ok) throw new Error("Scan failed");
  return res.json();
}

async function clearCart() {
  const res = await fetch(`${API_BASE}/api/cart/${CART_ID}/clear`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Clear failed");
  return res.json();
}

async function checkoutCart() {
  const res = await fetch(`${API_BASE}/api/cart/${CART_ID}/checkout`, {
    method: "POST",
  });
  return res.json();
}

async function fetchProducts() {
  const res = await fetch(`${API_BASE}/api/products`);
  if (!res.ok) throw new Error("Failed to fetch products");
  return res.json();
}

// ─── MAIN APP ───
export default function App() {
  const [cart, setCart] = useState({ items: [], total: 0 });
  const [products, setProducts] = useState({});
  const [toast, setToast] = useState(null);
  const [serverUp, setServerUp] = useState(false);
  const [lastAction, setLastAction] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [simTag, setSimTag] = useState("");
  const [loading, setLoading] = useState(false);
  const toastTimer = useRef(null);

  const showToast = useCallback((msg, type = "info") => {
    clearTimeout(toastTimer.current);
    setToast({ msg, type });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // Poll cart state (picks up ESP32 scans)
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const data = await fetchCart();
        if (active) {
          setCart(data.cart);
          setServerUp(true);
        }
      } catch {
        if (active) setServerUp(false);
      }
    };
    poll();
    const id = setInterval(poll, POLL_INTERVAL);
    return () => { active = false; clearInterval(id); };
  }, []);

  // Load products
  useEffect(() => {
    fetchProducts()
      .then((data) => setProducts(data.products))
      .catch(() => {});
  }, []);

  const handleSimScan = async () => {
    if (!simTag.trim()) return;
    setLoading(true);
    try {
      const data = await scanProduct(simTag.trim());
      setCart(data.cart);
      setLastAction(data);
      showToast(
        `${data.action === "added" ? "✓" : "✗"} ${data.product} ${data.action}`,
        data.action === "added" ? "success" : "warning"
      );
      setSimTag("");
    } catch {
      showToast("Scan failed – unknown tag?", "error");
    }
    setLoading(false);
  };

  const handleQuickScan = async (tagId) => {
    setLoading(true);
    try {
      const data = await scanProduct(tagId);
      setCart(data.cart);
      setLastAction(data);
      showToast(
        `${data.action === "added" ? "✓" : "✗"} ${data.product} ${data.action}`,
        data.action === "added" ? "success" : "warning"
      );
    } catch {
      showToast("Scan failed", "error");
    }
    setLoading(false);
  };

  const handleClear = async () => {
    try {
      const data = await clearCart();
      setCart(data.cart);
      setLastAction(null);
      showToast("Cart cleared", "info");
    } catch {
      showToast("Failed to clear", "error");
    }
  };

  const handleCheckout = async () => {
    if (cart.items.length === 0) return;
    try {
      const data = await checkoutCart();
      if (data.error) {
        showToast(data.error, "error");
        return;
      }
      setReceipt(data.receipt);
      setCart({ items: [], total: 0 });
      setLastAction(null);
    } catch {
      showToast("Checkout failed", "error");
    }
  };

  const productList = Object.entries(products);

  return (
    <>
      <style>{globalStyles}</style>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 16px 60px" }}>
        {/* ─── HEADER ─── */}
        <header style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 32, paddingBottom: 20,
          borderBottom: "1px solid var(--border)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: "linear-gradient(135deg, var(--accent), #0077ff)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 0 24px var(--accent-dim)",
            }}>
              <CartIcon />
            </div>
            <div>
              <h1 style={{
                fontFamily: "var(--mono)", fontSize: 22, fontWeight: 700,
                letterSpacing: "-0.5px", lineHeight: 1.2,
              }}>
                SMART CART
              </h1>
              <p style={{ fontSize: 12, color: "var(--text-dim)", fontFamily: "var(--mono)" }}>
                IoT Shopping Dashboard
              </p>
            </div>
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "6px 14px", borderRadius: 20,
            background: serverUp ? "var(--green-dim)" : "var(--red-dim)",
            border: `1px solid ${serverUp ? "var(--green)" : "var(--red)"}44`,
          }}>
            <WifiIcon connected={serverUp} />
            <span style={{
              fontFamily: "var(--mono)", fontSize: 11, fontWeight: 700,
              color: serverUp ? "var(--green)" : "var(--red)",
            }}>
              {serverUp ? "ONLINE" : "OFFLINE"}
            </span>
          </div>
        </header>

        {/* ─── TOAST ─── */}
        {toast && (
          <div style={{
            position: "fixed", top: 20, right: 20, zIndex: 1000,
            padding: "12px 20px", borderRadius: 10,
            fontFamily: "var(--mono)", fontSize: 13, fontWeight: 700,
            animation: "popIn 0.3s ease",
            background: toast.type === "success" ? "var(--green)" : toast.type === "error" ? "var(--red)" : toast.type === "warning" ? "var(--yellow)" : "var(--accent)",
            color: "#000",
            boxShadow: "0 8px 32px #00000066",
          }}>
            {toast.msg}
          </div>
        )}

        {/* ─── RECEIPT MODAL ─── */}
        {receipt && (
          <div style={{
            position: "fixed", inset: 0, zIndex: 999,
            background: "#000000aa", backdropFilter: "blur(8px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            animation: "fadeIn 0.2s ease",
          }} onClick={() => setReceipt(null)}>
            <div onClick={(e) => e.stopPropagation()} style={{
              background: "var(--surface)", borderRadius: 16,
              border: "1px solid var(--border)", padding: 32,
              maxWidth: 420, width: "90%",
              animation: "popIn 0.35s ease",
            }}>
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <div style={{
                  width: 56, height: 56, borderRadius: "50%",
                  background: "var(--green-dim)", border: "2px solid var(--green)",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  marginBottom: 12,
                }}>
                  <CheckIcon />
                </div>
                <h2 style={{ fontFamily: "var(--mono)", fontSize: 20 }}>Checkout Complete</h2>
                <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
                  {receipt.receiptId}
                </p>
              </div>
              <div style={{
                background: "var(--bg)", borderRadius: 10, padding: 16,
                border: "1px solid var(--border)", marginBottom: 16,
              }}>
                {receipt.items.map((item, i) => (
                  <div key={i} style={{
                    display: "flex", justifyContent: "space-between",
                    padding: "8px 0",
                    borderBottom: i < receipt.items.length - 1 ? "1px solid var(--border)" : "none",
                    fontSize: 14,
                  }}>
                    <span>{item.name}</span>
                    <span style={{ fontFamily: "var(--mono)", color: "var(--accent)" }}>₹{item.price}</span>
                  </div>
                ))}
              </div>
              <div style={{
                display: "flex", justifyContent: "space-between",
                padding: "12px 0", borderTop: "2px solid var(--accent)",
                fontFamily: "var(--mono)", fontSize: 18, fontWeight: 700,
              }}>
                <span>TOTAL</span>
                <span style={{ color: "var(--green)" }}>₹{receipt.total}</span>
              </div>
              <button onClick={() => setReceipt(null)} style={{
                width: "100%", marginTop: 16, padding: "12px",
                background: "var(--accent)", color: "#000",
                border: "none", borderRadius: 10, cursor: "pointer",
                fontFamily: "var(--mono)", fontWeight: 700, fontSize: 14,
              }}>
                DONE
              </button>
            </div>
          </div>
        )}

        {/* ─── MAIN GRID ─── */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 20,
        }}>
          {/* LEFT COLUMN */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* SCAN SIMULATOR */}
            <div style={{
              background: "var(--surface)", borderRadius: 14,
              border: "1px solid var(--border)", padding: 24,
              position: "relative", overflow: "hidden",
            }}>
              <div style={{
                position: "absolute", top: 0, left: 0, right: 0, height: 3,
                background: "linear-gradient(90deg, transparent, var(--accent), transparent)",
                animation: loading ? "scanline 1s ease infinite" : "none",
                opacity: loading ? 1 : 0,
              }} />
              <h3 style={{
                fontFamily: "var(--mono)", fontSize: 12, fontWeight: 700,
                color: "var(--text-dim)", marginBottom: 16,
                textTransform: "uppercase", letterSpacing: 1.5,
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <ScanIcon /> RFID Scanner (Simulator)
              </h3>
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  type="text"
                  placeholder="Enter Tag ID (e.g. A1B2C3D4)"
                  value={simTag}
                  onChange={(e) => setSimTag(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSimScan()}
                  style={{
                    flex: 1, padding: "10px 14px",
                    background: "var(--bg)", border: "1px solid var(--border)",
                    borderRadius: 8, color: "var(--text)",
                    fontFamily: "var(--mono)", fontSize: 13,
                    outline: "none", transition: "border-color 0.2s",
                  }}
                  onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
                  onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
                />
                <button onClick={handleSimScan} disabled={loading} style={{
                  padding: "10px 20px", background: "var(--accent)", color: "#000",
                  border: "none", borderRadius: 8, cursor: "pointer",
                  fontFamily: "var(--mono)", fontWeight: 700, fontSize: 13,
                  opacity: loading ? 0.6 : 1,
                }}>
                  SCAN
                </button>
              </div>

              {/* Quick scan buttons */}
              <div style={{ marginTop: 16 }}>
                <p style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--mono)", marginBottom: 8 }}>
                  QUICK SCAN (tap to simulate):
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {productList.map(([tag, prod]) => (
                    <button
                      key={tag}
                      onClick={() => handleQuickScan(tag)}
                      style={{
                        padding: "6px 12px", borderRadius: 6,
                        background: cart.items.some((i) => i.tag_id === tag)
                          ? "var(--green-dim)"
                          : "var(--surface-2)",
                        border: `1px solid ${
                          cart.items.some((i) => i.tag_id === tag)
                            ? "var(--green)" : "var(--border)"
                        }`,
                        color: "var(--text)", cursor: "pointer",
                        fontFamily: "var(--mono)", fontSize: 11,
                        transition: "all 0.15s",
                      }}
                    >
                      {prod.name} – ₹{prod.price}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* LAST ACTION */}
            {lastAction && (
              <div style={{
                background: "var(--surface)", borderRadius: 14,
                border: `1px solid ${lastAction.action === "added" ? "var(--green)" : "var(--yellow)"}44`,
                padding: 20, animation: "popIn 0.3s ease",
              }}>
                <h3 style={{
                  fontFamily: "var(--mono)", fontSize: 12, fontWeight: 700,
                  color: "var(--text-dim)", marginBottom: 10,
                  textTransform: "uppercase", letterSpacing: 1.5,
                }}>
                  LAST SCAN
                </h3>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <p style={{ fontSize: 16, fontWeight: 700 }}>{lastAction.product}</p>
                    <p style={{
                      fontFamily: "var(--mono)", fontSize: 12, marginTop: 4,
                      color: lastAction.action === "added" ? "var(--green)" : "var(--yellow)",
                      textTransform: "uppercase", fontWeight: 700,
                    }}>
                      {lastAction.action === "added" ? "✓ ADDED TO CART" : "✗ REMOVED FROM CART"}
                    </p>
                  </div>
                  <span style={{
                    fontFamily: "var(--mono)", fontSize: 24, fontWeight: 700,
                    color: "var(--accent)",
                  }}>
                    ₹{lastAction.price}
                  </span>
                </div>
              </div>
            )}

            {/* STATS */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12,
            }}>
              {[
                { label: "ITEMS", value: cart.items.length, color: "var(--accent)" },
                { label: "TOTAL", value: `₹${cart.total}`, color: "var(--green)" },
              ].map((s) => (
                <div key={s.label} style={{
                  background: "var(--surface)", borderRadius: 14,
                  border: "1px solid var(--border)", padding: 20,
                  textAlign: "center",
                }}>
                  <p style={{
                    fontFamily: "var(--mono)", fontSize: 11,
                    color: "var(--text-dim)", letterSpacing: 1.5,
                    marginBottom: 6,
                  }}>{s.label}</p>
                  <p style={{
                    fontFamily: "var(--mono)", fontSize: 32, fontWeight: 700,
                    color: s.color,
                  }}>{s.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT COLUMN – CART */}
          <div style={{
            background: "var(--surface)", borderRadius: 14,
            border: "1px solid var(--border)",
            display: "flex", flexDirection: "column",
            minHeight: 500,
          }}>
            <div style={{
              padding: "20px 24px", borderBottom: "1px solid var(--border)",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <h3 style={{
                fontFamily: "var(--mono)", fontSize: 12, fontWeight: 700,
                color: "var(--text-dim)", textTransform: "uppercase",
                letterSpacing: 1.5,
              }}>
                🛒 Cart ({cart.items.length})
              </h3>
              {cart.items.length > 0 && (
                <button onClick={handleClear} style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 12px", borderRadius: 6,
                  background: "var(--red-dim)", border: "1px solid var(--red)44",
                  color: "var(--red)", cursor: "pointer",
                  fontFamily: "var(--mono)", fontSize: 11, fontWeight: 700,
                }}>
                  <TrashIcon /> CLEAR
                </button>
              )}
            </div>

            <div style={{ flex: 1, padding: "12px 24px", overflowY: "auto" }}>
              {cart.items.length === 0 ? (
                <div style={{
                  height: "100%", display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center",
                  color: "var(--text-dim)", textAlign: "center",
                }}>
                  <p style={{ fontSize: 48, marginBottom: 12, opacity: 0.3 }}>🛒</p>
                  <p style={{ fontFamily: "var(--mono)", fontSize: 13 }}>Cart is empty</p>
                  <p style={{ fontSize: 12, marginTop: 4 }}>Scan an RFID tag to add items</p>
                </div>
              ) : (
                cart.items.map((item, i) => (
                  <div key={item.tag_id} style={{
                    display: "flex", justifyContent: "space-between",
                    alignItems: "center", padding: "14px 0",
                    borderBottom: i < cart.items.length - 1 ? "1px solid var(--border)" : "none",
                    animation: `slideUp 0.3s ease ${i * 0.05}s both`,
                  }}>
                    <div>
                      <p style={{ fontSize: 15, fontWeight: 500 }}>{item.name}</p>
                      <p style={{
                        fontFamily: "var(--mono)", fontSize: 10,
                        color: "var(--text-dim)", marginTop: 3,
                      }}>
                        {item.category} · {item.tag_id.slice(0, 8)}
                      </p>
                    </div>
                    <span style={{
                      fontFamily: "var(--mono)", fontSize: 16, fontWeight: 700,
                      color: "var(--accent)",
                    }}>
                      ₹{item.price}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* CHECKOUT FOOTER */}
            {cart.items.length > 0 && (
              <div style={{
                padding: "16px 24px", borderTop: "1px solid var(--border)",
              }}>
                <div style={{
                  display: "flex", justifyContent: "space-between",
                  marginBottom: 14, fontFamily: "var(--mono)",
                }}>
                  <span style={{ fontSize: 14, color: "var(--text-dim)" }}>
                    {cart.items.length} item{cart.items.length > 1 ? "s" : ""}
                  </span>
                  <span style={{ fontSize: 20, fontWeight: 700, color: "var(--green)" }}>
                    ₹{cart.total}
                  </span>
                </div>
                <button onClick={handleCheckout} style={{
                  width: "100%", padding: "14px",
                  background: "linear-gradient(135deg, var(--green), #059669)",
                  color: "#fff", border: "none", borderRadius: 10,
                  cursor: "pointer", fontFamily: "var(--mono)",
                  fontWeight: 700, fontSize: 14, letterSpacing: 1,
                  boxShadow: "0 4px 20px var(--green-dim)",
                  transition: "transform 0.15s, box-shadow 0.15s",
                }}
                  onMouseDown={(e) => (e.target.style.transform = "scale(0.98)")}
                  onMouseUp={(e) => (e.target.style.transform = "scale(1)")}
                >
                  CHECKOUT →
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ─── FOOTER ─── */}
        <footer style={{
          marginTop: 40, textAlign: "center",
          fontFamily: "var(--mono)", fontSize: 11,
          color: "var(--text-dim)",
        }}>
          SMART CART v1.0 · ESP32 + React + Express · Embedded Systems Project
        </footer>
      </div>
    </>
  );
}
