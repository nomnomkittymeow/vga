import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ─── Font injection ───────────────────────────────────────────────────────────
const injectFont = () => {
  if (document.getElementById("vga-font")) return;
  const l = document.createElement("link");
  l.id = "vga-font"; l.rel = "stylesheet";
  l.href = "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Orbitron:wght@500;700;900&display=swap";
  document.head.appendChild(l);
};

// ─── Palette ──────────────────────────────────────────────────────────────────
const C = {
  bg:     "#070b14",
  panel:  "#0c1220",
  card:   "#0f1828",
  border: "#1a2840",
  border2:"#243555",
  cyan:   "#00e5ff",
  cyanDim:"#00a8bd",
  green:  "#00ff88",
  orange: "#ff8c00",
  purple: "#8b6fff",
  red:    "#ff4455",
  yellow: "#ffd166",
  text:   "#c8d8f0",
  textDim:"#607090",
  textFaint:"#334055",
};

// ─── VGA Timing Presets ───────────────────────────────────────────────────────
const PRESETS = [
  { id:"vga",   label:"VGA",    sub:"640×480@60",  tag:"VGA",
    ha:640,hfp:16, hs:96, hbp:48,  va:480,vfp:11,vs:2,vbp:31,  hpol:"neg",vpol:"neg",ref:60 },
  { id:"svga",  label:"SVGA",   sub:"800×600@60",  tag:"SVGA",
    ha:800,hfp:40, hs:128,hbp:88,  va:600,vfp:1, vs:4,vbp:23,  hpol:"pos",vpol:"pos",ref:60 },
  { id:"xga",   label:"XGA",    sub:"1024×768@60", tag:"XGA",
    ha:1024,hfp:24,hs:136,hbp:160, va:768,vfp:3, vs:6,vbp:29,  hpol:"neg",vpol:"neg",ref:60 },
  { id:"wxga",  label:"WXGA",   sub:"1280×800@60", tag:"WXGA",
    ha:1280,hfp:64,hs:136,hbp:200, va:800,vfp:1, vs:3,vbp:24,  hpol:"neg",vpol:"pos",ref:60 },
  { id:"hd720", label:"HD 720p",sub:"1280×720@60", tag:"HD",
    ha:1280,hfp:110,hs:40,hbp:220, va:720,vfp:5, vs:5,vbp:20,  hpol:"pos",vpol:"pos",ref:60 },
  { id:"sxga",  label:"SXGA",   sub:"1280×1024@60",tag:"SXGA",
    ha:1280,hfp:48,hs:112,hbp:248, va:1024,vfp:1,vs:3,vbp:38,  hpol:"pos",vpol:"pos",ref:60 },
  { id:"fhd",   label:"FHD 1080p",sub:"1920×1080@60",tag:"FHD",
    ha:1920,hfp:88,hs:44,hbp:148,  va:1080,vfp:4,vs:5,vbp:36,  hpol:"pos",vpol:"pos",ref:60 },
  { id:"custom",label:"Custom", sub:"user defined", tag:"USR",
    ha:640,hfp:16, hs:96, hbp:48,  va:480,vfp:11,vs:2,vbp:31,  hpol:"neg",vpol:"neg",ref:60 },
];

const FPGA_TARGETS = [
  { id:"xilinx",   label:"Xilinx / AMD",   note:"Vivado PLL range: 6.25–800 MHz" },
  { id:"intel",    label:"Intel / Altera",  note:"Quartus PLL range: 5–800 MHz" },
  { id:"lattice",  label:"Lattice ECP5",    note:"EHXPLLL range: 10–400 MHz" },
  { id:"gowin",    label:"Gowin GW1N",      note:"rPLL range: 3–500 MHz" },
];

// ─── Calculation Engine ───────────────────────────────────────────────────────
function calcTiming(p) {
  const ht = p.ha + p.hfp + p.hs + p.hbp;
  const vt = p.va + p.vfp + p.vs + p.vbp;
  const pclk_hz = ht * vt * p.ref;
  const pclk_mhz = pclk_hz / 1e6;
  const h_freq_khz = pclk_hz / ht / 1e3;
  const frame_ms = 1000 / p.ref;
  const line_us  = frame_ms * 1e3 / vt;
  const pix_ns   = 1e9 / pclk_hz;
  const bw_gbps  = pclk_mhz * 24 / 1e3;
  const fb_mb    = (p.ha * p.va * 3) / (1024 * 1024);
  const fb_mb2   = (p.ha * p.va * 4) / (1024 * 1024);
  const duty_h   = (p.ha / ht * 100).toFixed(1);
  const duty_v   = (p.va / vt * 100).toFixed(1);
  const blanking_h = ht - p.ha;
  const blanking_v = vt - p.va;
  return { ...p, ht, vt, pclk_hz, pclk_mhz, h_freq_khz, frame_ms, line_us,
           pix_ns, bw_gbps, fb_mb, fb_mb2, duty_h, duty_v,
           blanking_h, blanking_v, total_px: ht * vt, active_px: p.ha * p.va };
}

// ─── Validation ───────────────────────────────────────────────────────────────
function validate(t) {
  const logs = [];
  const ts = Date.now();
  const info  = (m) => logs.push({ type:"info",  msg: m, ts });
  const warn  = (m) => logs.push({ type:"warn",  msg: m, ts });
  const error = (m) => logs.push({ type:"error", msg: m, ts });
  const ok    = (m) => logs.push({ type:"ok",    msg: m, ts });

  ok(`Timing validated: ${t.ha}×${t.va} @ ${t.ref}Hz`);
  info(`Pixel clock: ${t.pclk_mhz.toFixed(3)} MHz  |  H-freq: ${t.h_freq_khz.toFixed(3)} kHz`);
  info(`Frame time: ${t.frame_ms.toFixed(3)} ms  |  Line time: ${t.line_us.toFixed(3)} µs`);

  if (t.pclk_mhz > 250) warn("Pixel clock >250 MHz — may exceed standard PLL limits on most FPGAs.");
  if (t.pclk_mhz > 400) error("Pixel clock >400 MHz — likely infeasible on most mid-range FPGAs.");
  if (t.pclk_mhz < 1)   error("Pixel clock <1 MHz — unrealistically low. Check your parameters.");

  if (t.hs < 8)  warn(`H-sync width (${t.hs}) is very short — may violate display timing standards.`);
  if (t.vs < 2)  warn(`V-sync width (${t.vs}) is very short — some monitors may not lock sync.`);

  if (t.hfp < 1) warn("H-front-porch < 1 pixel — violates VGA specifications.");
  if (t.vfp < 1) warn("V-front-porch < 1 line — violates VGA specifications.");

  const duty = parseFloat(t.duty_h);
  if (duty < 50) warn(`H-active duty cycle is ${t.duty_h}% — low efficiency (lots of blanking).`);
  if (duty > 90) warn(`H-active duty cycle is ${t.duty_h}% — very tight blanking, check monitor compatibility.`);

  if (t.ref > 120) warn("Refresh rate >120 Hz — ensure FPGA pixel clock can be generated cleanly.");
  if (t.ref < 50)  warn("Refresh rate <50 Hz — may cause visible flicker on analog monitors.");

  if (t.pclk_mhz > 25 && t.pclk_mhz < 200)
    ok(`Pixel clock ${t.pclk_mhz.toFixed(2)} MHz is within typical FPGA PLL range.`);

  // Suggest PLL factor
  const common_ref = 100;
  const mult = Math.round(t.pclk_mhz * 10) / 10;
  info(`PLL hint: ${common_ref} MHz ref → M=${Math.round(t.pclk_mhz)}, D=1 (adjust for exact clock)`);
  info(`Frame buffer (RGB888): ${t.fb_mb.toFixed(2)} MB  |  RGBA8888: ${t.fb_mb2.toFixed(2)} MB`);
  info(`Memory bandwidth: ${t.bw_gbps.toFixed(3)} Gbit/s at 24bpp`);

  return logs;
}

// ─── Verilog Code Generators ──────────────────────────────────────────────────
function genVerilog(t) {
  const sp = (n) => String(n).padStart(5);
  return `// ============================================================
// VGA Timing Controller — Verilog RTL
// Generated by: VGA Timing Studio v2.0
// Resolution  : ${t.ha}x${t.va} @ ${t.ref}Hz
// Pixel Clock : ${t.pclk_mhz.toFixed(4)} MHz
// H-Sync Pol. : ${t.hpol === 'neg' ? 'Negative (active-low)' : 'Positive (active-high)'}
// V-Sync Pol. : ${t.vpol === 'neg' ? 'Negative (active-low)' : 'Positive (active-high)'}
// ============================================================
module vga_controller #(
    // ── Horizontal Timing ─────────────────────────────
    parameter H_ACTIVE      = ${sp(t.ha)},  // Active pixels
    parameter H_FRONT_PORCH = ${sp(t.hfp)},  // Front porch pixels
    parameter H_SYNC_WIDTH  = ${sp(t.hs)},  // Sync pulse width
    parameter H_BACK_PORCH  = ${sp(t.hbp)},  // Back porch pixels
    parameter H_TOTAL       = ${sp(t.ht)},  // Total pixels/line
    // ── Vertical Timing ───────────────────────────────
    parameter V_ACTIVE      = ${sp(t.va)},  // Active lines
    parameter V_FRONT_PORCH = ${sp(t.vfp)},  // Front porch lines
    parameter V_SYNC_WIDTH  = ${sp(t.vs)},  // Sync pulse width
    parameter V_BACK_PORCH  = ${sp(t.vbp)},  // Back porch lines
    parameter V_TOTAL       = ${sp(t.vt)},  // Total lines/frame
    // ── Sync Polarity ─────────────────────────────────
    parameter H_SYNC_POL    = 1'b${t.hpol === 'pos' ? '1' : '0'},   // 1=pos 0=neg
    parameter V_SYNC_POL    = 1'b${t.vpol === 'pos' ? '1' : '0'}    // 1=pos 0=neg
) (
    input  wire        clk,          // Pixel clock ${t.pclk_mhz.toFixed(3)} MHz
    input  wire        rst_n,        // Asynchronous reset (active-low)
    output reg         hsync,        // Horizontal sync signal
    output reg         vsync,        // Vertical sync signal
    output reg         de,           // Display enable (active video)
    output reg [11:0]  pixel_x,      // Current active pixel X (0 when blanking)
    output reg [11:0]  pixel_y,      // Current active pixel Y (0 when blanking)
    output wire        frame_start   // Pulses high for 1 clk at frame start
);

    // ── Internal Counters ─────────────────────────────
    reg [11:0] h_cnt;   // Horizontal counter [0..H_TOTAL-1]
    reg [11:0] v_cnt;   // Vertical counter   [0..V_TOTAL-1]

    // ── Horizontal Counter ────────────────────────────
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            h_cnt <= 12'd0;
        else if (h_cnt == H_TOTAL - 1)
            h_cnt <= 12'd0;
        else
            h_cnt <= h_cnt + 12'd1;
    end

    // ── Vertical Counter ──────────────────────────────
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            v_cnt <= 12'd0;
        else if (h_cnt == H_TOTAL - 1) begin
            if (v_cnt == V_TOTAL - 1)
                v_cnt <= 12'd0;
            else
                v_cnt <= v_cnt + 12'd1;
        end
    end

    // ── Combinatorial Sync Regions ────────────────────
    wire h_sync_region = (h_cnt >= H_ACTIVE + H_FRONT_PORCH) &&
                         (h_cnt <  H_ACTIVE + H_FRONT_PORCH + H_SYNC_WIDTH);

    wire v_sync_region = (v_cnt >= V_ACTIVE + V_FRONT_PORCH) &&
                         (v_cnt <  V_ACTIVE + V_FRONT_PORCH + V_SYNC_WIDTH);

    wire h_active_region = (h_cnt < H_ACTIVE);
    wire v_active_region = (v_cnt < V_ACTIVE);

    // ── Output Register Stage ─────────────────────────
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            hsync   <= ~H_SYNC_POL;
            vsync   <= ~V_SYNC_POL;
            de      <= 1'b0;
            pixel_x <= 12'd0;
            pixel_y <= 12'd0;
        end else begin
            hsync   <= h_sync_region ? H_SYNC_POL : ~H_SYNC_POL;
            vsync   <= v_sync_region ? V_SYNC_POL : ~V_SYNC_POL;
            de      <= h_active_region & v_active_region;
            pixel_x <= h_active_region ? h_cnt : 12'd0;
            pixel_y <= v_active_region ? v_cnt : 12'd0;
        end
    end

    // ── Frame Start Strobe ────────────────────────────
    assign frame_start = (h_cnt == 12'd0) && (v_cnt == 12'd0);

endmodule
`;
}

function genSV(t) {
  return `// ============================================================
// VGA Timing Controller — SystemVerilog RTL
// Generated by: VGA Timing Studio v2.0
// Resolution  : ${t.ha}x${t.va} @ ${t.ref}Hz
// Pixel Clock : ${t.pclk_mhz.toFixed(4)} MHz
// ============================================================
module vga_controller
    import vga_pkg::*;
#(
    parameter int unsigned H_ACTIVE      = ${t.ha},
    parameter int unsigned H_FRONT_PORCH = ${t.hfp},
    parameter int unsigned H_SYNC_WIDTH  = ${t.hs},
    parameter int unsigned H_BACK_PORCH  = ${t.hbp},
    parameter int unsigned H_TOTAL       = ${t.ht},
    parameter int unsigned V_ACTIVE      = ${t.va},
    parameter int unsigned V_FRONT_PORCH = ${t.vfp},
    parameter int unsigned V_SYNC_WIDTH  = ${t.vs},
    parameter int unsigned V_BACK_PORCH  = ${t.vbp},
    parameter int unsigned V_TOTAL       = ${t.vt},
    parameter logic        H_SYNC_POL    = 1'b${t.hpol === 'pos' ? '1' : '0'},
    parameter logic        V_SYNC_POL    = 1'b${t.vpol === 'pos' ? '1' : '0'}
) (
    input  logic        clk,
    input  logic        rst_n,
    output logic        hsync,
    output logic        vsync,
    output logic        de,
    output logic [11:0] pixel_x,
    output logic [11:0] pixel_y,
    output logic        frame_start
);
    // Packed counter struct
    logic [11:0] h_cnt, v_cnt;

    // Horizontal counter
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)                      h_cnt <= '0;
        else if (h_cnt == H_TOTAL - 1)  h_cnt <= '0;
        else                             h_cnt <= h_cnt + 1'b1;
    end

    // Vertical counter
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)                                       v_cnt <= '0;
        else if (h_cnt == H_TOTAL - 1) begin
            if (v_cnt == V_TOTAL - 1) v_cnt <= '0;
            else                      v_cnt <= v_cnt + 1'b1;
        end
    end

    // Sync and active region detection (combinatorial)
    logic h_sync_rgn, v_sync_rgn, h_act, v_act;
    always_comb begin
        h_sync_rgn = (h_cnt inside {[H_ACTIVE+H_FRONT_PORCH : H_ACTIVE+H_FRONT_PORCH+H_SYNC_WIDTH-1]});
        v_sync_rgn = (v_cnt inside {[V_ACTIVE+V_FRONT_PORCH : V_ACTIVE+V_FRONT_PORCH+V_SYNC_WIDTH-1]});
        h_act      = (h_cnt < H_ACTIVE);
        v_act      = (v_cnt < V_ACTIVE);
    end

    // Registered outputs
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            hsync   <= ~H_SYNC_POL;
            vsync   <= ~V_SYNC_POL;
            de      <= 1'b0;
            pixel_x <= '0;
            pixel_y <= '0;
        end else begin
            hsync   <= h_sync_rgn ? H_SYNC_POL : ~H_SYNC_POL;
            vsync   <= v_sync_rgn ? V_SYNC_POL : ~V_SYNC_POL;
            de      <= h_act & v_act;
            pixel_x <= h_act ? h_cnt : '0;
            pixel_y <= v_act ? v_cnt : '0;
        end
    end

    assign frame_start = (h_cnt == '0) && (v_cnt == '0);

endmodule
`;
}

function genVHDL(t) {
  return `-- ============================================================
-- VGA Timing Controller — VHDL RTL
-- Generated by: VGA Timing Studio v2.0
-- Resolution  : ${t.ha}x${t.va} @ ${t.ref}Hz
-- Pixel Clock : ${t.pclk_mhz.toFixed(4)} MHz
-- ============================================================
library IEEE;
use IEEE.STD_LOGIC_1164.ALL;
use IEEE.NUMERIC_STD.ALL;

entity vga_controller is
    generic (
        H_ACTIVE      : integer := ${t.ha};
        H_FRONT_PORCH : integer := ${t.hfp};
        H_SYNC_WIDTH  : integer := ${t.hs};
        H_BACK_PORCH  : integer := ${t.hbp};
        H_TOTAL       : integer := ${t.ht};
        V_ACTIVE      : integer := ${t.va};
        V_FRONT_PORCH : integer := ${t.vfp};
        V_SYNC_WIDTH  : integer := ${t.vs};
        V_BACK_PORCH  : integer := ${t.vbp};
        V_TOTAL       : integer := ${t.vt};
        H_SYNC_POL    : std_logic := '${t.hpol === 'pos' ? '1' : '0'}';
        V_SYNC_POL    : std_logic := '${t.vpol === 'pos' ? '1' : '0'}'
    );
    port (
        clk         : in  std_logic;
        rst_n       : in  std_logic;
        hsync       : out std_logic;
        vsync       : out std_logic;
        de          : out std_logic;
        pixel_x     : out std_logic_vector(11 downto 0);
        pixel_y     : out std_logic_vector(11 downto 0);
        frame_start : out std_logic
    );
end entity vga_controller;

architecture rtl of vga_controller is
    signal h_cnt : unsigned(11 downto 0) := (others => '0');
    signal v_cnt : unsigned(11 downto 0) := (others => '0');
begin

    -- Horizontal counter
    p_hcnt : process(clk, rst_n)
    begin
        if rst_n = '0' then
            h_cnt <= (others => '0');
        elsif rising_edge(clk) then
            if h_cnt = to_unsigned(H_TOTAL - 1, 12) then
                h_cnt <= (others => '0');
            else
                h_cnt <= h_cnt + 1;
            end if;
        end if;
    end process;

    -- Vertical counter
    p_vcnt : process(clk, rst_n)
    begin
        if rst_n = '0' then
            v_cnt <= (others => '0');
        elsif rising_edge(clk) then
            if h_cnt = to_unsigned(H_TOTAL - 1, 12) then
                if v_cnt = to_unsigned(V_TOTAL - 1, 12) then
                    v_cnt <= (others => '0');
                else
                    v_cnt <= v_cnt + 1;
                end if;
            end if;
        end if;
    end process;

    -- Output generation
    p_out : process(clk, rst_n)
        variable h_sync_rgn : boolean;
        variable v_sync_rgn : boolean;
        variable h_act      : boolean;
        variable v_act      : boolean;
    begin
        if rst_n = '0' then
            hsync   <= not H_SYNC_POL;
            vsync   <= not V_SYNC_POL;
            de      <= '0';
            pixel_x <= (others => '0');
            pixel_y <= (others => '0');
        elsif rising_edge(clk) then
            h_sync_rgn := (h_cnt >= H_ACTIVE + H_FRONT_PORCH) and
                          (h_cnt <  H_ACTIVE + H_FRONT_PORCH + H_SYNC_WIDTH);
            v_sync_rgn := (v_cnt >= V_ACTIVE + V_FRONT_PORCH) and
                          (v_cnt <  V_ACTIVE + V_FRONT_PORCH + V_SYNC_WIDTH);
            h_act := (h_cnt < H_ACTIVE);
            v_act := (v_cnt < V_ACTIVE);

            hsync   <= H_SYNC_POL when h_sync_rgn else not H_SYNC_POL;
            vsync   <= V_SYNC_POL when v_sync_rgn else not V_SYNC_POL;
            de      <= '1' when (h_act and v_act) else '0';
            pixel_x <= std_logic_vector(h_cnt) when h_act else (others => '0');
            pixel_y <= std_logic_vector(v_cnt) when v_act else (others => '0');
        end if;
    end process;

    frame_start <= '1' when (h_cnt = 0 and v_cnt = 0) else '0';

end architecture rtl;
`;
}

// ─── Syntax Highlighter ───────────────────────────────────────────────────────
function highlight(code, lang) {
  let s = code.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  if (lang === "vhdl") {
    s = s.replace(/(--.*)$/gm, `<span style="color:#6a9955">$1</span>`);
    s = s.replace(/\b(library|use|entity|architecture|is|of|begin|end|port|generic|process|signal|variable|if|elsif|else|then|when|rising_edge|std_logic|std_logic_vector|unsigned|integer|natural|boolean|in|out|inout|others|not|and|or|downto|to)\b/g,
      `<span style="color:#569cd6">$1</span>`);
    s = s.replace(/\b(\d+)\b/g, `<span style="color:#b5cea8">$1</span>`);
    s = s.replace(/'([01XU])'/g, `<span style="color:#ce9178">'$1'</span>`);
  } else {
    s = s.replace(/(\/\/.*)$/gm, `<span style="color:#6a9955">$1</span>`);
    s = s.replace(/\b(module|endmodule|input|output|inout|wire|reg|logic|always|always_ff|always_comb|begin|end|if|else|assign|parameter|localparam|posedge|negedge|or|and|import|inside)\b/g,
      `<span style="color:#569cd6">$1</span>`);
    s = s.replace(/\b(\d+'\s*[bdhBDH][0-9a-fA-FxXzZ_]+|\d+)\b/g,
      `<span style="color:#b5cea8">$1</span>`);
    s = s.replace(/\b(clk|rst_n|hsync|vsync|de|pixel_x|pixel_y|h_cnt|v_cnt|frame_start|h_sync_rgn|v_sync_rgn|h_act|v_act)\b/g,
      `<span style="color:#9cdcfe">$1</span>`);
    s = s.replace(/\b(vga_controller|vga_pkg)\b/g,
      `<span style="color:#dcdcaa">$1</span>`);
    s = s.replace(/\b(H_ACTIVE|H_FRONT_PORCH|H_SYNC_WIDTH|H_BACK_PORCH|H_TOTAL|V_ACTIVE|V_FRONT_PORCH|V_SYNC_WIDTH|V_BACK_PORCH|V_TOTAL|H_SYNC_POL|V_SYNC_POL)\b/g,
      `<span style="color:#4ec9b0">$1</span>`);
  }
  return s;
}

// ─── Waveform Canvas ──────────────────────────────────────────────────────────
function WaveformCanvas({ timing, zoom }) {
  const ref = useRef();
  const raf = useRef();
  const tick = useRef(0);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const draw = () => {
      tick.current = (tick.current + 0.4) % 1000;
      const W = canvas.width, H = canvas.height;
      ctx.fillStyle = "#060a10";
      ctx.fillRect(0, 0, W, H);

      // CRT grid
      ctx.strokeStyle = "rgba(0,220,100,0.06)";
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 60) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
      for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

      // Bright center lines
      ctx.strokeStyle = "rgba(0,220,100,0.12)";
      ctx.beginPath(); ctx.moveTo(0,H/2); ctx.lineTo(W,H/2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W/2,0); ctx.lineTo(W/2,H); ctx.stroke();

      const LP = 72, RP = 8, PW = W - LP - RP;
      const NC = zoom; // number of H cycles
      const CW = PW / NC;

      const { ha, hfp, hs, hbp, ht, va, vfp, vs, vbp, vt, hpol, vpol } = timing;

      const SIGNALS = [
        { name:"HSYNC", cy: H*0.18, amp:H*0.075, color:"#00e5ff" },
        { name:"VSYNC", cy: H*0.38, amp:H*0.075, color:"#ff8c00" },
        { name:"DE",    cy: H*0.58, amp:H*0.075, color:"#00ff88" },
        { name:"PCLK",  cy: H*0.78, amp:H*0.055, color:"#8b6fff" },
      ];

      SIGNALS.forEach(sig => {
        // Label bg
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(2, sig.cy - 14, 68, 20);
        ctx.fillStyle = sig.color;
        ctx.font = "bold 11px 'JetBrains Mono', monospace";
        ctx.fillText(sig.name, 6, sig.cy + 3);

        // Glow line
        ctx.save();
        ctx.strokeStyle = sig.color;
        ctx.lineWidth = 2;
        ctx.shadowColor = sig.color;
        ctx.shadowBlur = 10;
        ctx.beginPath();

        if (sig.name === "HSYNC") {
          const syncH = hpol === "neg" ? sig.cy + sig.amp : sig.cy - sig.amp;
          const restH = hpol === "neg" ? sig.cy - sig.amp : sig.cy + sig.amp;
          const syncS = (ha + hfp) / ht;
          const syncE = (ha + hfp + hs) / ht;
          ctx.moveTo(LP, restH);
          for (let c = 0; c < NC; c++) {
            const ox = LP + c * CW;
            ctx.lineTo(ox + syncS * CW, restH);
            ctx.lineTo(ox + syncS * CW, syncH);
            ctx.lineTo(ox + syncE * CW, syncH);
            ctx.lineTo(ox + syncE * CW, restH);
          }
          ctx.lineTo(LP + PW, restH);
        } else if (sig.name === "VSYNC") {
          const syncH = vpol === "neg" ? sig.cy + sig.amp : sig.cy - sig.amp;
          const restH = vpol === "neg" ? sig.cy - sig.amp : sig.cy + sig.amp;
          const syncS = (va + vfp) / vt;
          const syncE = (va + vfp + vs) / vt;
          ctx.moveTo(LP, restH);
          ctx.lineTo(LP + syncS * PW, restH);
          ctx.lineTo(LP + syncS * PW, syncH);
          ctx.lineTo(LP + syncE * PW, syncH);
          ctx.lineTo(LP + syncE * PW, restH);
          ctx.lineTo(LP + PW, restH);
        } else if (sig.name === "DE") {
          const hi = sig.cy - sig.amp, lo = sig.cy + sig.amp;
          const ae = ha / ht;
          ctx.moveTo(LP, hi);
          for (let c = 0; c < NC; c++) {
            const ox = LP + c * CW;
            ctx.lineTo(ox + ae * CW, hi);
            ctx.lineTo(ox + ae * CW, lo);
            ctx.lineTo(ox + CW,     lo);
            ctx.lineTo(ox + CW,     hi);
          }
        } else {
          // PCLK: draw ~32 pulses per cycle
          const ticks = Math.min(32, NC * 4);
          const tw = PW / ticks;
          const hi = sig.cy - sig.amp, lo = sig.cy + sig.amp;
          ctx.moveTo(LP, lo);
          for (let i = 0; i < ticks; i++) {
            const x = LP + i * tw;
            ctx.lineTo(x, lo);
            ctx.lineTo(x, hi);
            ctx.lineTo(x + tw * 0.5, hi);
            ctx.lineTo(x + tw * 0.5, lo);
          }
          ctx.lineTo(LP + PW, lo);
        }
        ctx.stroke();
        ctx.restore();
      });

      // Animated scan cursor
      const cursorX = LP + ((tick.current / 100) % 1) * PW;
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3,3]);
      ctx.beginPath(); ctx.moveTo(cursorX, 0); ctx.lineTo(cursorX, H);
      ctx.stroke();
      ctx.restore();

      // Region labels (below HSYNC row)
      const lY = H * 0.18 + H * 0.075 + 14;
      const regions = [
        { start:0,       w:ha/ht,  label:"ACTIVE", clr:"#00ff88" },
        { start:ha/ht,   w:hfp/ht, label:"FP",     clr:C.textDim },
        { start:(ha+hfp)/ht, w:hs/ht, label:"SYNC",clr:"#00e5ff" },
        { start:(ha+hfp+hs)/ht, w:hbp/ht, label:"BP", clr:C.textDim },
      ];
      ctx.font = "9px 'JetBrains Mono', monospace";
      regions.forEach(r => {
        const rx = LP + r.start * CW;
        const rw = r.w * CW;
        if (rw < 12) return;
        ctx.fillStyle = r.clr + "20";
        ctx.fillRect(rx, lY - 8, rw, 14);
        ctx.fillStyle = r.clr;
        ctx.fillText(r.label, rx + rw / 2 - ctx.measureText(r.label).width / 2, lY + 2);
        ctx.strokeStyle = r.clr + "60";
        ctx.lineWidth = 1;
        ctx.strokeRect(rx, lY - 8, rw, 14);
      });

      raf.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(raf.current);
  }, [timing, zoom]);

  return (
    <canvas
      ref={ref}
      width={900} height={340}
      style={{ width:"100%", height:"100%", display:"block" }}
    />
  );
}

// ─── CRT Monitor Preview ──────────────────────────────────────────────────────
function CRTPreview({ timing, crtMode }) {
  const ref = useRef();
  const raf = useRef();
  const scanLine = useRef(0);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;

    const frameH = H * 0.88, frameY = H * 0.06;
    const frameW = frameH * (timing.ha / timing.va);
    const frameX = (W - frameW) / 2;

    const draw = () => {
      ctx.clearRect(0, 0, W, H);

      // Monitor bezel
      const bevel = 12;
      const grad = ctx.createLinearGradient(0,0,W,H);
      grad.addColorStop(0,"#1e2a3c");
      grad.addColorStop(1,"#0d1520");
      ctx.fillStyle = grad;
      roundRect(ctx, frameX - bevel, frameY - bevel, frameW + bevel*2, frameH + bevel*2, 8);
      ctx.fill();
      ctx.strokeStyle = "#2a3f5a";
      ctx.lineWidth = 1.5;
      roundRect(ctx, frameX - bevel, frameY - bevel, frameW + bevel*2, frameH + bevel*2, 8);
      ctx.stroke();

      // Screen black
      ctx.fillStyle = "#000";
      ctx.fillRect(frameX, frameY, frameW, frameH);

      // Active region highlight
      const ax = frameX, ay = frameY;
      const aw = frameW * (timing.ha / timing.ht);
      const ah = frameH * (timing.va / timing.vt);

      // Blanking
      ctx.fillStyle = "rgba(0,50,80,0.3)";
      ctx.fillRect(frameX, frameY, frameW, frameH);

      // Active area  
      if (crtMode === "retro") {
        const ag = ctx.createRadialGradient(ax+aw/2,ay+ah/2,0,ax+aw/2,ay+ah/2,Math.max(aw,ah)*0.7);
        ag.addColorStop(0,"rgba(0,200,80,0.15)");
        ag.addColorStop(1,"rgba(0,50,20,0.05)");
        ctx.fillStyle = ag;
      } else {
        ctx.fillStyle = "rgba(20,60,100,0.4)";
      }
      ctx.fillRect(ax, ay, aw, ah);

      // Scanlines (CRT effect)
      if (crtMode === "retro" || crtMode === "scanline") {
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        for (let sy = ay; sy < ay + ah; sy += 3) {
          ctx.fillRect(ax, sy + 1, aw, 1);
        }
      }

      // Animated electron beam
      const beamY = ay + (scanLine.current / timing.vt) * frameH;
      if (beamY < ay + frameH) {
        const bg = ctx.createLinearGradient(ax, beamY - 6, ax, beamY + 3);
        const beamColor = crtMode === "retro" ? "0,255,80" : "0,200,255";
        bg.addColorStop(0,"transparent");
        bg.addColorStop(0.5,`rgba(${beamColor},0.7)`);
        bg.addColorStop(1,"transparent");
        ctx.fillStyle = bg;
        ctx.fillRect(ax, beamY - 6, aw, 9);

        // Phosphor glow
        if (crtMode !== "plain") {
          ctx.shadowColor = crtMode === "retro" ? "#00ff50" : "#00e5ff";
          ctx.shadowBlur = 12;
          ctx.fillStyle = crtMode === "retro" ? "rgba(0,255,80,0.15)" : "rgba(0,229,255,0.1)";
          ctx.fillRect(ax, beamY - 2, aw, 4);
          ctx.shadowBlur = 0;
        }
      }

      // Blanking region labels
      ctx.font = "9px 'JetBrains Mono', monospace";
      ctx.fillStyle = "rgba(100,160,200,0.6)";
      if (frameW - aw > 20) {
        ctx.save();
        ctx.translate(frameX + aw + (frameW - aw)/2, ay + ah/2);
        ctx.rotate(Math.PI/2);
        ctx.fillText("H-BLANK", -20, 0);
        ctx.restore();
      }
      if (frameH - ah > 16) {
        ctx.fillText("V-BLANK", ax + 4, ay + ah + (frameH - ah)/2 + 3);
      }

      // Corner dots (resolution indicators)
      ctx.fillStyle = "#00e5ff";
      ctx.beginPath(); ctx.arc(ax, ay, 2.5, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(ax+aw, ay, 2.5, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(ax, ay+ah, 2.5, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(ax+aw, ay+ah, 2.5, 0, Math.PI*2); ctx.fill();

      // Monitor stand
      ctx.fillStyle = "#0f1825";
      ctx.fillRect(W/2 - 20, frameY + frameH + bevel + 2, 40, 8);
      ctx.fillRect(W/2 - 35, frameY + frameH + bevel + 10, 70, 4);

      scanLine.current = (scanLine.current + 0.8) % (timing.vt + 20);
      raf.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(raf.current);
  }, [timing, crtMode]);

  return (
    <canvas
      ref={ref}
      width={380} height={260}
      style={{ width:"100%", height:"100%", display:"block" }}
    />
  );
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}

// ─── Reusable UI Components ───────────────────────────────────────────────────
const btn = (extra="") =>
  `display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:5px;border:1px solid ${C.border2};background:${C.card};color:${C.text};font-family:'JetBrains Mono',monospace;font-size:12px;cursor:pointer;transition:all .15s;${extra}`;

function Btn({ children, onClick, active, color=C.cyan, style={}, title="" }) {
  const [hov, setHov] = useState(false);
  const s = {
    display:"inline-flex",alignItems:"center",gap:6,padding:"5px 12px",borderRadius:5,
    border:`1px solid ${active||hov ? color : C.border2}`,
    background: active ? color+"22" : hov ? color+"11" : C.card,
    color: active||hov ? color : C.text,
    fontFamily:"'JetBrains Mono',monospace", fontSize:12, cursor:"pointer",
    transition:"all .15s", boxShadow: (active||hov) ? `0 0 8px ${color}44` : "none",
    ...style
  };
  return (
    <button style={s} onClick={onClick} title={title}
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}>
      {children}
    </button>
  );
}

function Knob({ label, value, min, max, step=1, unit="", onChange, color=C.cyan }) {
  return (
    <div style={{marginBottom:10}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
        <span style={{fontSize:11,color:C.textDim,fontFamily:"'JetBrains Mono',monospace"}}>{label}</span>
        <span style={{fontSize:11,color,fontFamily:"'JetBrains Mono',monospace",fontWeight:600}}>
          {value}{unit}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e=>onChange(Number(e.target.value))}
        style={{width:"100%",accentColor:color,height:4,cursor:"pointer"}} />
    </div>
  );
}

function NumInput({ label, value, onChange, min, max, color=C.cyan }) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
      <span style={{fontSize:11,color:C.textDim,fontFamily:"'JetBrains Mono',monospace",width:90,flexShrink:0}}>{label}</span>
      <input type="number" value={value} min={min} max={max}
        onChange={e=>onChange(Number(e.target.value))}
        style={{
          width:"100%",padding:"3px 6px",background:C.bg,border:`1px solid ${C.border2}`,
          borderRadius:4,color,fontFamily:"'JetBrains Mono',monospace",fontSize:12,outline:"none"
        }} />
    </div>
  );
}

function Stat({ label, value, unit="", color=C.cyan, alert=false }) {
  return (
    <div style={{
      padding:"7px 10px",background:C.bg,borderRadius:5,
      border:`1px solid ${alert?C.red:C.border}`,marginBottom:5
    }}>
      <div style={{fontSize:10,color:C.textDim,fontFamily:"'JetBrains Mono',monospace",marginBottom:2}}>{label}</div>
      <div style={{fontSize:14,fontWeight:700,color:alert?C.red:color,fontFamily:"'JetBrains Mono',monospace",letterSpacing:1}}>
        {value}<span style={{fontSize:10,fontWeight:400,color:C.textDim,marginLeft:4}}>{unit}</span>
      </div>
    </div>
  );
}

function Card({ title, icon="", children, style={} }) {
  return (
    <div style={{
      background:C.panel,borderRadius:7,border:`1px solid ${C.border}`,
      marginBottom:10,overflow:"hidden",...style
    }}>
      {title && (
        <div style={{
          padding:"7px 12px",borderBottom:`1px solid ${C.border}`,
          display:"flex",alignItems:"center",gap:6,
          background:`linear-gradient(90deg,${C.card},${C.panel})`
        }}>
          {icon && <span style={{fontSize:12}}>{icon}</span>}
          <span style={{fontSize:11,fontWeight:700,color:C.textDim,fontFamily:"'JetBrains Mono',monospace",letterSpacing:1,textTransform:"uppercase"}}>
            {title}
          </span>
        </div>
      )}
      <div style={{padding:12}}>{children}</div>
    </div>
  );
}

// ─── Main Application ─────────────────────────────────────────────────────────
export default function VGATimingStudio() {
  useEffect(() => { injectFont(); }, []);

  const [cfg, setCfg] = useState({ ...PRESETS[0] });
  const [presetId, setPresetId] = useState("vga");
  const [codeTab, setCodeTab] = useState("verilog");
  const [crtMode, setCrtMode] = useState("color");
  const [fpga, setFpga] = useState("xilinx");
  const [waveZoom, setWaveZoom] = useState(3);
  const [copied, setCopied] = useState(false);
  const [showCRT, setShowCRT] = useState(true);
  const [panel, setPanel] = useState("code"); // "code" | "utils" | "timing"

  const timing = useMemo(() => calcTiming(cfg), [cfg]);
  const logs    = useMemo(() => validate(timing), [timing]);

  const applyPreset = (p) => {
    setPresetId(p.id);
    setCfg({ ...p });
  };

  const update = (k, v) => {
    setCfg(prev => ({ ...prev, [k]: v }));
    if (presetId !== "custom") setPresetId("custom");
  };

  const code = codeTab === "verilog" ? genVerilog(timing)
             : codeTab === "sv"      ? genSV(timing)
             :                         genVHDL(timing);

  const copyCode = () => {
    navigator.clipboard.writeText(code).catch(()=>{});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadFile = () => {
    const ext = codeTab === "vhdl" ? "vhd" : codeTab === "sv" ? "sv" : "v";
    const blob = new Blob([code], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `vga_controller_${timing.ha}x${timing.va}_${timing.ref}hz.${ext}`;
    a.click();
  };

  const downloadJSON = () => {
    const exp = {
      resolution: `${timing.ha}x${timing.va}`,
      refresh: timing.ref,
      pixel_clock_mhz: timing.pclk_mhz,
      h_timing: { active:timing.ha, front_porch:timing.hfp, sync:timing.hs, back_porch:timing.hbp, total:timing.ht, polarity:timing.hpol },
      v_timing: { active:timing.va, front_porch:timing.vfp, sync:timing.vs, back_porch:timing.vbp, total:timing.vt, polarity:timing.vpol },
      derived: { h_freq_khz:timing.h_freq_khz, frame_ms:timing.frame_ms, line_us:timing.line_us, pixel_ns:timing.pix_ns }
    };
    const blob = new Blob([JSON.stringify(exp,null,2)], { type:"application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `vga_timing_${timing.ha}x${timing.va}.json`;
    a.click();
  };

  const codeLang = codeTab === "vhdl" ? "vhdl" : "verilog";
  const highlightedCode = useMemo(() => highlight(code, codeLang), [code, codeLang]);
  const lines = code.split("\n");

  const warnCount = logs.filter(l=>l.type==="warn"||l.type==="error").length;

  // ─── Layout ───────────────────────────────────────────────────────────────
  return (
    <div style={{
      fontFamily:"'JetBrains Mono',monospace",
      background:C.bg, color:C.text,
      minHeight:"100vh", display:"flex", flexDirection:"column",
      userSelect:"none"
    }}>

      {/* ── Header ── */}
      <div style={{
        display:"flex",alignItems:"center",gap:12,padding:"8px 16px",
        background:C.panel,borderBottom:`1px solid ${C.border}`,
        boxShadow:"0 2px 20px rgba(0,0,0,0.5)", flexShrink:0
      }}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{
            width:28,height:28,borderRadius:6,
            background:`linear-gradient(135deg,${C.cyan},${C.purple})`,
            display:"flex",alignItems:"center",justifyContent:"center",fontSize:14
          }}>⬡</div>
          <div>
            <div style={{fontSize:13,fontWeight:700,color:C.cyan,letterSpacing:2,lineHeight:1}}>VGA TIMING STUDIO</div>
            <div style={{fontSize:9,color:C.textDim,letterSpacing:1}}>FPGA ENGINEERING WORKBENCH v2.0</div>
          </div>
        </div>

        <div style={{width:1,height:28,background:C.border,margin:"0 8px"}} />

        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
          {PRESETS.filter(p=>p.id!=="custom").map(p => (
            <Btn key={p.id} active={presetId===p.id} onClick={()=>applyPreset(p)}
              color={p.id==="vga"?C.green:p.id==="fhd"?C.orange:C.cyan}>
              {p.label}
            </Btn>
          ))}
        </div>

        <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
          <div style={{
            padding:"3px 10px",borderRadius:4,
            background:C.bg,border:`1px solid ${C.border2}`,
            fontSize:11,color:C.cyan,letterSpacing:1
          }}>
            {timing.pclk_mhz.toFixed(3)} MHz
          </div>
          <div style={{
            padding:"3px 10px",borderRadius:4,
            background:C.bg,border:`1px solid ${warnCount>0?C.yellow:C.border2}`,
            fontSize:11,color:warnCount>0?C.yellow:C.textDim
          }}>
            {warnCount > 0 ? `⚠ ${warnCount} warn` : "✓ OK"}
          </div>
        </div>
      </div>

      {/* ── Main Workspace ── */}
      <div style={{display:"flex",flex:1,overflow:"hidden",minHeight:0}}>

        {/* ─ LEFT PANEL ─ */}
        <div style={{
          width:240,flexShrink:0,background:C.panel,
          borderRight:`1px solid ${C.border}`,
          overflowY:"auto",padding:10,
          scrollbarWidth:"thin"
        }}>

          <Card title="Resolution" icon="◈">
            <NumInput label="H Active"  value={cfg.ha}  onChange={v=>update("ha",v)}  min={64}  max={4096} color={C.green} />
            <NumInput label="V Active"  value={cfg.va}  onChange={v=>update("va",v)}  min={64}  max={2160} color={C.green} />
            <Knob label="Refresh Rate" value={cfg.ref} min={24} max={240} unit=" Hz"
              onChange={v=>update("ref",v)} color={C.purple} />
          </Card>

          <Card title="H Timing" icon="→">
            <NumInput label="Front Porch" value={cfg.hfp} onChange={v=>update("hfp",v)} min={1} max={512} color={C.cyan} />
            <NumInput label="Sync Width"  value={cfg.hs}  onChange={v=>update("hs",v)}  min={1} max={512} color={C.cyan} />
            <NumInput label="Back Porch"  value={cfg.hbp} onChange={v=>update("hbp",v)} min={1} max={512} color={C.cyan} />
            <div style={{display:"flex",gap:4,marginTop:6}}>
              {["neg","pos"].map(pol => (
                <Btn key={pol} active={cfg.hpol===pol} onClick={()=>update("hpol",pol)} color={C.cyan}
                  style={{flex:1,justifyContent:"center"}}>
                  {pol.toUpperCase()}
                </Btn>
              ))}
            </div>
          </Card>

          <Card title="V Timing" icon="↓">
            <NumInput label="Front Porch" value={cfg.vfp} onChange={v=>update("vfp",v)} min={1} max={128} color={C.orange} />
            <NumInput label="Sync Width"  value={cfg.vs}  onChange={v=>update("vs",v)}  min={1} max={128} color={C.orange} />
            <NumInput label="Back Porch"  value={cfg.vbp} onChange={v=>update("vbp",v)} min={1} max={128} color={C.orange} />
            <div style={{display:"flex",gap:4,marginTop:6}}>
              {["neg","pos"].map(pol => (
                <Btn key={pol} active={cfg.vpol===pol} onClick={()=>update("vpol",pol)} color={C.orange}
                  style={{flex:1,justifyContent:"center"}}>
                  {pol.toUpperCase()}
                </Btn>
              ))}
            </div>
          </Card>

          <Card title="FPGA Target" icon="◻">
            {FPGA_TARGETS.map(t => (
              <div key={t.id} onClick={()=>setFpga(t.id)} style={{
                padding:"6px 8px",borderRadius:5,marginBottom:4,cursor:"pointer",
                border:`1px solid ${fpga===t.id?C.purple:C.border}`,
                background:fpga===t.id?C.purple+"22":C.bg,
                transition:"all .15s"
              }}>
                <div style={{fontSize:11,fontWeight:600,color:fpga===t.id?C.purple:C.text}}>{t.label}</div>
                <div style={{fontSize:9,color:C.textDim,marginTop:2}}>{t.note}</div>
              </div>
            ))}
          </Card>

          <Card title="CRT Preview" icon="◉">
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
              {[["color","Color"],["scanline","Scanlines"],["retro","Retro"],["plain","Plain"]].map(([id,label]) => (
                <Btn key={id} active={crtMode===id} onClick={()=>setCrtMode(id)} color={C.green}
                  style={{justifyContent:"center",fontSize:10}}>
                  {label}
                </Btn>
              ))}
            </div>
          </Card>

        </div>

        {/* ─ CENTER PANEL ─ */}
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0}}>

          {/* Waveform panel */}
          <div style={{
            flex:"0 0 auto",background:C.panel,
            borderBottom:`1px solid ${C.border}`,padding:10
          }}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <span style={{fontSize:10,color:C.textDim,letterSpacing:1,textTransform:"uppercase"}}>⚡ Timing Waveforms</span>
              <div style={{marginLeft:"auto",display:"flex",gap:4,alignItems:"center"}}>
                <span style={{fontSize:10,color:C.textDim}}>Cycles:</span>
                {[2,3,5,8].map(z => (
                  <Btn key={z} active={waveZoom===z} onClick={()=>setWaveZoom(z)}
                    style={{padding:"2px 8px",fontSize:10}}>{z}×</Btn>
                ))}
              </div>
            </div>
            <div style={{height:220,borderRadius:5,overflow:"hidden",border:`1px solid ${C.border}`}}>
              <WaveformCanvas timing={timing} zoom={waveZoom} />
            </div>
          </div>

          {/* CRT Preview + Timing Table */}
          <div style={{flex:1,display:"flex",overflow:"hidden",minHeight:0}}>

            {/* CRT */}
            <div style={{
              flex:"0 0 auto",width:280,
              background:C.bg,borderRight:`1px solid ${C.border}`,
              display:"flex",flexDirection:"column",padding:10,gap:8
            }}>
              <div style={{fontSize:10,color:C.textDim,letterSpacing:1,textTransform:"uppercase"}}>◉ Monitor Preview</div>
              <div style={{flex:1,minHeight:0}}>
                <CRTPreview timing={timing} crtMode={crtMode} />
              </div>
              <div style={{fontSize:10,color:C.textDim,textAlign:"center",lineHeight:1.6}}>
                <div style={{color:C.cyan}}>{timing.ha}×{timing.va}</div>
                <div>Active: {(parseFloat(timing.duty_h)*parseFloat(timing.duty_v)/100).toFixed(1)}% utilization</div>
              </div>
            </div>

            {/* Timing breakdown table */}
            <div style={{flex:1,overflowY:"auto",padding:10,scrollbarWidth:"thin"}}>
              <div style={{fontSize:10,color:C.textDim,letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>
                📊 Timing Breakdown
              </div>

              {/* H-timing bar */}
              <div style={{marginBottom:12}}>
                <div style={{fontSize:10,color:C.textDim,marginBottom:4}}>Horizontal Period (1 line = {timing.line_us.toFixed(3)} µs)</div>
                <div style={{display:"flex",height:22,borderRadius:4,overflow:"hidden",border:`1px solid ${C.border}`}}>
                  {[
                    {w:timing.ha/timing.ht, c:"#00ff8840", label:"Active"},
                    {w:timing.hfp/timing.ht, c:"#ffffff10", label:"FP"},
                    {w:timing.hs/timing.ht, c:"#00e5ff40", label:"SYNC"},
                    {w:timing.hbp/timing.ht, c:"#ffffff10", label:"BP"},
                  ].map((seg,i) => (
                    <div key={i} style={{
                      flex:`${seg.w} 0 0`,background:seg.c,
                      display:"flex",alignItems:"center",justifyContent:"center",
                      fontSize:9,color:"rgba(255,255,255,0.6)",overflow:"hidden",
                      borderRight:i<3?`1px solid ${C.border}`:""
                    }}>
                      {seg.w > 0.05 ? seg.label : ""}
                    </div>
                  ))}
                </div>
                <div style={{display:"flex",justifyContent:"space-between",marginTop:3}}>
                  {[
                    {v:timing.ha, u:"px", l:"Active"},
                    {v:timing.hfp,u:"px", l:"FP"},
                    {v:timing.hs, u:"px", l:"Sync"},
                    {v:timing.hbp,u:"px", l:"BP"},
                  ].map((x,i) => (
                    <div key={i} style={{fontSize:9,color:C.textDim,textAlign:"center"}}>
                      <span style={{color:C.text}}>{x.v}</span>{x.u}
                    </div>
                  ))}
                </div>
              </div>

              {/* V-timing bar */}
              <div style={{marginBottom:12}}>
                <div style={{fontSize:10,color:C.textDim,marginBottom:4}}>Vertical Period (1 frame = {timing.frame_ms.toFixed(3)} ms)</div>
                <div style={{display:"flex",height:22,borderRadius:4,overflow:"hidden",border:`1px solid ${C.border}`}}>
                  {[
                    {w:timing.va/timing.vt, c:"#ff8c0040", label:"Active"},
                    {w:timing.vfp/timing.vt, c:"#ffffff10", label:"FP"},
                    {w:timing.vs/timing.vt, c:"#ff8c0080", label:"SYNC"},
                    {w:timing.vbp/timing.vt, c:"#ffffff10", label:"BP"},
                  ].map((seg,i) => (
                    <div key={i} style={{
                      flex:`${seg.w} 0 0`,background:seg.c,
                      display:"flex",alignItems:"center",justifyContent:"center",
                      fontSize:9,color:"rgba(255,255,255,0.6)",overflow:"hidden",
                      borderRight:i<3?`1px solid ${C.border}`:""
                    }}>
                      {seg.w > 0.03 ? seg.label : ""}
                    </div>
                  ))}
                </div>
              </div>

              {/* Stats grid */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                <Stat label="Pixel Clock"      value={timing.pclk_mhz.toFixed(4)} unit="MHz"  color={C.cyan} alert={timing.pclk_mhz>400} />
                <Stat label="H-Frequency"      value={timing.h_freq_khz.toFixed(3)} unit="kHz" color={C.cyan} />
                <Stat label="Frame Time"        value={timing.frame_ms.toFixed(3)} unit="ms"   color={C.orange} />
                <Stat label="Line Time"         value={timing.line_us.toFixed(3)} unit="µs"    color={C.orange} />
                <Stat label="Pixel Period"      value={timing.pix_ns.toFixed(3)} unit="ns"     color={C.green} />
                <Stat label="H Total"           value={timing.ht} unit="px"                    color={C.green} />
                <Stat label="V Total"           value={timing.vt} unit="lines"                 color={C.green} />
                <Stat label="Total Pixels"      value={(timing.total_px/1e6).toFixed(3)} unit="Mpx" color={C.textDim} />
                <Stat label="Bandwidth"         value={timing.bw_gbps.toFixed(3)} unit="Gbit/s" color={C.purple} alert={timing.bw_gbps>20} />
                <Stat label="Framebuffer (RGB)" value={timing.fb_mb.toFixed(2)} unit="MB"      color={C.purple} />
                <Stat label="H Duty Cycle"      value={timing.duty_h} unit="%"                  color={C.textDim} />
                <Stat label="V Duty Cycle"      value={timing.duty_v} unit="%"                  color={C.textDim} />
              </div>
            </div>
          </div>
        </div>

        {/* ─ RIGHT PANEL ─ */}
        <div style={{
          width:420,flexShrink:0,background:C.panel,
          borderLeft:`1px solid ${C.border}`,
          display:"flex",flexDirection:"column",overflow:"hidden"
        }}>

          {/* Tab bar */}
          <div style={{
            display:"flex",borderBottom:`1px solid ${C.border}`,flexShrink:0,
            background:C.bg
          }}>
            {[["code","⟨/⟩ Code"],["timing","≡ Timing"],["utils","⚙ Utils"]].map(([id,label]) => (
              <div key={id} onClick={()=>setPanel(id)} style={{
                padding:"8px 14px",fontSize:11,cursor:"pointer",fontWeight:600,
                borderBottom:`2px solid ${panel===id?C.cyan:"transparent"}`,
                color:panel===id?C.cyan:C.textDim, transition:"all .15s",
                letterSpacing:0.5
              }}>{label}</div>
            ))}
          </div>

          {/* CODE TAB */}
          {panel === "code" && (
            <div style={{display:"flex",flexDirection:"column",flex:1,overflow:"hidden"}}>
              {/* Language tabs + actions */}
              <div style={{
                display:"flex",alignItems:"center",gap:6,padding:"8px 10px",
                borderBottom:`1px solid ${C.border}`,flexShrink:0,flexWrap:"wrap"
              }}>
                {[["verilog","Verilog"],["sv","SystemVerilog"],["vhdl","VHDL"]].map(([id,l]) => (
                  <Btn key={id} active={codeTab===id} onClick={()=>setCodeTab(id)} color={C.cyan}
                    style={{fontSize:10,padding:"3px 8px"}}>
                    {l}
                  </Btn>
                ))}
                <div style={{marginLeft:"auto",display:"flex",gap:4}}>
                  <Btn onClick={copyCode} color={copied?C.green:C.cyan} style={{fontSize:10,padding:"3px 8px"}}>
                    {copied ? "✓ Copied" : "⎘ Copy"}
                  </Btn>
                  <Btn onClick={downloadFile} color={C.purple} style={{fontSize:10,padding:"3px 8px"}}>
                    ↓ .{codeTab==="vhdl"?"vhd":codeTab==="sv"?"sv":"v"}
                  </Btn>
                </div>
              </div>

              {/* Code editor */}
              <div style={{flex:1,overflowY:"auto",scrollbarWidth:"thin",background:"#0d1117"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                  <tbody>
                    {lines.map((line, i) => (
                      <tr key={i} style={{lineHeight:"1.6"}}>
                        <td style={{
                          userSelect:"none",padding:"0 8px 0 12px",
                          color:C.textFaint,textAlign:"right",
                          width:32,borderRight:`1px solid ${C.border}`,
                          fontSize:10, fontFamily:"'JetBrains Mono',monospace",
                          verticalAlign:"top"
                        }}>{i+1}</td>
                        <td style={{padding:"0 12px",fontFamily:"'JetBrains Mono',monospace",
                          whiteSpace:"pre",overflow:"hidden",verticalAlign:"top"}}
                          dangerouslySetInnerHTML={{__html: highlight(line, codeLang) || "&nbsp;"}} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TIMING TAB */}
          {panel === "timing" && (
            <div style={{flex:1,overflowY:"auto",padding:10,scrollbarWidth:"thin"}}>
              <div style={{fontSize:10,color:C.textDim,letterSpacing:1,marginBottom:8,textTransform:"uppercase"}}>Complete Timing Parameters</div>

              {[
                ["Parameter","Value","Unit"],
                ["─── Configuration ───","",""],
                ["H Active",timing.ha,"px"],
                ["H Front Porch",timing.hfp,"px"],
                ["H Sync Width",timing.hs,"px"],
                ["H Back Porch",timing.hbp,"px"],
                ["H Total",timing.ht,"px"],
                ["H Sync Polarity",timing.hpol.toUpperCase(),""],
                ["─── Vertical ───","",""],
                ["V Active",timing.va,"lines"],
                ["V Front Porch",timing.vfp,"lines"],
                ["V Sync Width",timing.vs,"lines"],
                ["V Back Porch",timing.vbp,"lines"],
                ["V Total",timing.vt,"lines"],
                ["V Sync Polarity",timing.vpol.toUpperCase(),""],
                ["─── Derived ───","",""],
                ["Pixel Clock",timing.pclk_mhz.toFixed(4),"MHz"],
                ["H Frequency",timing.h_freq_khz.toFixed(4),"kHz"],
                ["Refresh Rate",timing.ref,"Hz"],
                ["Frame Duration",timing.frame_ms.toFixed(4),"ms"],
                ["Line Duration",timing.line_us.toFixed(4),"µs"],
                ["Pixel Period",timing.pix_ns.toFixed(4),"ns"],
                ["Total Pixels/Frame",(timing.total_px).toLocaleString(),"px"],
                ["Active Pixels",(timing.active_px).toLocaleString(),"px"],
                ["H Blanking",timing.blanking_h,"px"],
                ["V Blanking",timing.blanking_v,"lines"],
                ["H Active Duty",timing.duty_h,"%"],
                ["V Active Duty",timing.duty_v,"%"],
                ["─── Memory ───","",""],
                ["Framebuffer RGB888",timing.fb_mb.toFixed(3),"MB"],
                ["Framebuffer RGBA8888",timing.fb_mb2.toFixed(3),"MB"],
                ["Bandwidth @24bpp",timing.bw_gbps.toFixed(4),"Gbit/s"],
              ].map(([k,v,u],i) => {
                if (String(k).startsWith("─")) return (
                  <div key={i} style={{fontSize:9,color:C.textFaint,padding:"6px 0 2px",letterSpacing:1,textTransform:"uppercase"}}>{k}</div>
                );
                const isHeader = k==="Parameter";
                return (
                  <div key={i} style={{
                    display:"flex",justifyContent:"space-between",alignItems:"center",
                    padding:"4px 8px",borderRadius:3,
                    background:i%2===0?"transparent":C.bg,
                    borderBottom:`1px solid ${C.border}`
                  }}>
                    <span style={{fontSize:10,color:isHeader?C.textDim:C.text}}>{k}</span>
                    <span style={{fontSize:11,fontWeight:600,
                      color:isHeader?C.textDim:C.cyan,letterSpacing:0.5}}>
                      {v}<span style={{fontSize:9,fontWeight:400,color:C.textDim,marginLeft:4}}>{u}</span>
                    </span>
                  </div>
                );
              })}

              <div style={{marginTop:12,display:"flex",gap:6}}>
                <Btn onClick={downloadJSON} color={C.orange} style={{flex:1,justifyContent:"center",fontSize:10}}>
                  ↓ Export JSON
                </Btn>
              </div>
            </div>
          )}

          {/* UTILS TAB */}
          {panel === "utils" && (
            <div style={{flex:1,overflowY:"auto",padding:10,scrollbarWidth:"thin"}}>
              <div style={{fontSize:10,color:C.textDim,letterSpacing:1,marginBottom:8,textTransform:"uppercase"}}>Engineering Utilities</div>

              <Card title="PLL Clock Suggestions" icon="⌚">
                {[50,100,125,200].map(refClk => {
                  const mult = Math.round(timing.pclk_mhz / refClk * 16) / 16;
                  const actual = refClk * mult;
                  const err = Math.abs((actual - timing.pclk_mhz) / timing.pclk_mhz * 100);
                  return (
                    <div key={refClk} style={{
                      display:"flex",justifyContent:"space-between",padding:"4px 8px",
                      marginBottom:4,borderRadius:4,background:C.bg,
                      border:`1px solid ${err<0.5?C.green+"44":C.border}`
                    }}>
                      <span style={{fontSize:10,color:C.textDim}}>{refClk}MHz → M={mult.toFixed(2)}</span>
                      <span style={{fontSize:10,color:err<0.5?C.green:C.yellow}}>
                        {actual.toFixed(2)} MHz ({err.toFixed(2)}% err)
                      </span>
                    </div>
                  );
                })}
              </Card>

              <Card title="Memory BW Calculator" icon="⬛">
                {[
                  ["8-bit (grayscale)", 1],
                  ["16-bit (RGB565)",   2],
                  ["24-bit (RGB888)",   3],
                  ["32-bit (RGBA8888)", 4],
                ].map(([label, bpp]) => {
                  const bw = timing.pclk_mhz * bpp * 8 / 1000;
                  return (
                    <div key={label} style={{
                      display:"flex",justifyContent:"space-between",padding:"4px 8px",
                      marginBottom:4,borderRadius:4,background:C.bg,border:`1px solid ${C.border}`
                    }}>
                      <span style={{fontSize:10,color:C.textDim}}>{label}</span>
                      <span style={{fontSize:10,color:C.purple}}>{bw.toFixed(2)} Gbit/s</span>
                    </div>
                  );
                })}
              </Card>

              <Card title="FPGA Resource Estimate" icon="◻">
                <div style={{fontSize:10,color:C.textDim,marginBottom:8,lineHeight:1.7}}>
                  <div>H counter: <span style={{color:C.cyan}}>12-bit reg (1 FF per bit)</span></div>
                  <div>V counter: <span style={{color:C.cyan}}>12-bit reg</span></div>
                  <div>Comparators: <span style={{color:C.cyan}}>~4 × 12-bit = 48 LUT</span></div>
                  <div>Output regs: <span style={{color:C.cyan}}>~5 FFs</span></div>
                  <div style={{marginTop:8,padding:"6px 8px",background:C.bg,borderRadius:4,
                    border:`1px solid ${C.green}44`,color:C.green}}>
                    Total: ~72 LUT + 29 FF (minimal)
                  </div>
                </div>
              </Card>

              <Card title="Timing Constraint" icon="⏱">
                <div style={{
                  background:"#0d1117",borderRadius:4,padding:8,
                  fontFamily:"'JetBrains Mono',monospace",fontSize:10,lineHeight:1.7,
                  border:`1px solid ${C.border}`
                }}>
                  <div><span style={{color:C.purple}}>create_clock</span> <span style={{color:C.cyan}}>-period</span> <span style={{color:C.orange}}>{(1000/timing.pclk_mhz).toFixed(3)}</span> \</div>
                  <div style={{paddingLeft:16}}><span style={{color:C.cyan}}>-name</span> <span style={{color:C.green}}>pxl_clk</span> \</div>
                  <div style={{paddingLeft:16}}>[<span style={{color:C.cyan}}>get_ports</span> <span style={{color:C.green}}>clk</span>]</div>
                  <div style={{marginTop:6,color:C.textDim}}># XDC for Xilinx / Vivado</div>
                  <div style={{marginTop:4,color:C.textDim}}># Period = {(1000/timing.pclk_mhz).toFixed(3)} ns</div>
                  <div style={{color:C.textDim}}># Freq = {timing.pclk_mhz.toFixed(4)} MHz</div>
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>

      {/* ── Terminal / Console ── */}
      <div style={{
        height:120,flexShrink:0,background:"#060910",
        borderTop:`1px solid ${C.border}`,overflowY:"auto",
        scrollbarWidth:"thin",padding:"6px 0"
      }}>
        <div style={{padding:"0 12px",marginBottom:4,display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:9,color:C.textDim,letterSpacing:2,textTransform:"uppercase"}}>▶ Output Console</span>
          <div style={{width:6,height:6,borderRadius:"50%",background:C.green,boxShadow:`0 0 6px ${C.green}`}} />
        </div>
        {logs.map((l, i) => {
          const color = l.type==="ok"?"#00ff88":l.type==="warn"?"#ffd166":l.type==="error"?"#ff4455":"#607090";
          const icon  = l.type==="ok"?"✓":l.type==="warn"?"⚠":l.type==="error"?"✗":"ℹ";
          return (
            <div key={i} style={{
              padding:"1px 16px",fontSize:11,color,lineHeight:1.6,
              fontFamily:"'JetBrains Mono',monospace",
              borderLeft:i===0?`2px solid ${color}`:"2px solid transparent"
            }}>
              <span style={{opacity:0.6,marginRight:8}}>{icon}</span>{l.msg}
            </div>
          );
        })}
      </div>

    </div>
  );
}
