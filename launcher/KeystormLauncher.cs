// KEYSTORM desktop launcher.
//
// Compiled on the player's PC by Install-Keystorm.ps1 with the C# compiler that
// ships with the .NET Framework (so this file sticks to C# 5 syntax).
//
// Flow: show splash -> run `node launcher\keystorm-core.mjs` (update check,
// download, build, local server) -> mirror its status.json on the splash ->
// open the game in a chromeless Edge/Chrome app window -> when that window
// closes, stop the local server.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Management;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("KEYSTORM")]
[assembly: AssemblyProduct("KEYSTORM")]
[assembly: AssemblyDescription("KEYSTORM launcher - checks for updates, then starts the game")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace Keystorm
{
    internal static class Native
    {
        [DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();

        [DllImport("user32.dll")]
        public static extern bool ReleaseCapture();

        [DllImport("user32.dll")]
        public static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

        [DllImport("dwmapi.dll")]
        public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
    }

    internal static class Program
    {
        public static string Root;
        public static int Port = 47615;
        public static string BrowserPref = "auto";

        [STAThread]
        private static int Main(string[] args)
        {
            try { Native.SetProcessDPIAware(); } catch (Exception) { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            Root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            try
            {
                foreach (string stale in Directory.GetFiles(Root, "KEYSTORM.old*.exe")) TryDelete(stale);
            }
            catch (Exception) { }
            ReadConfig();

            bool owner;
            using (Mutex mutex = new Mutex(true, "Local\\KeystormLauncher", out owner))
            {
                if (!owner)
                {
                    // Another launcher is already running. If the game is up, just open another window on it.
                    if (Launcher.ServerAlive(Port)) Launcher.OpenGameWindow(Launcher.GameUrl(Port), false);
                    return 0;
                }

                Splash splash = new Splash();
                Application.Run(splash);
                return splash.ExitCode;
            }
        }

        private static void ReadConfig()
        {
            try
            {
                string file = Path.Combine(Root, "launcher.config.json");
                if (!File.Exists(file)) return;
                Dictionary<string, object> cfg = new JavaScriptSerializer().DeserializeObject(File.ReadAllText(file)) as Dictionary<string, object>;
                if (cfg == null) return;
                object v;
                if (cfg.TryGetValue("port", out v) && v != null) Port = Convert.ToInt32(v);
                if (cfg.TryGetValue("browser", out v) && v != null) BrowserPref = Convert.ToString(v).ToLowerInvariant();
            }
            catch (Exception e)
            {
                Log("config: " + e.Message);
            }
        }

        public static void TryDelete(string file)
        {
            try { if (File.Exists(file)) File.Delete(file); } catch (Exception) { }
        }

        public static void Log(string line)
        {
            try
            {
                string dir = Path.Combine(Root, "logs");
                Directory.CreateDirectory(dir);
                File.AppendAllText(Path.Combine(dir, "launcher.log"), DateTime.Now.ToString("s") + " " + line + Environment.NewLine);
            }
            catch (Exception) { }
        }
    }

    /// <summary>Process plumbing: Node.js, the core script and the browser window.</summary>
    internal static class Launcher
    {
        public static string GameUrl(int port)
        {
            return "http://127.0.0.1:" + port + "/";
        }

        public static bool ServerAlive(int port)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/__keystorm");
                req.Timeout = 900;
                req.Proxy = null;
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                using (StreamReader r = new StreamReader(res.GetResponseStream()))
                {
                    return r.ReadToEnd().Contains("\"keystorm\"");
                }
            }
            catch (Exception)
            {
                return false;
            }
        }

        public static string FindNode()
        {
            string path = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string dir in path.Split(Path.PathSeparator))
            {
                try
                {
                    string d = dir.Trim().Trim('"');
                    if (d.Length == 0) continue;
                    string candidate = Path.Combine(Environment.ExpandEnvironmentVariables(d), "node.exe");
                    if (File.Exists(candidate)) return candidate;
                }
                catch (Exception) { }
            }
            string[] guesses = new string[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs\\node.exe"),
                Path.Combine(Environment.GetEnvironmentVariable("ProgramFiles(x86)") ?? "C:\\Program Files (x86)", "nodejs\\node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs\\nodejs\\node.exe"),
            };
            foreach (string g in guesses) if (File.Exists(g)) return g;
            return null;
        }

        private static string AppPath(string exe)
        {
            foreach (RegistryKey hive in new RegistryKey[] { Registry.CurrentUser, Registry.LocalMachine })
            {
                try
                {
                    using (RegistryKey k = hive.OpenSubKey("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\" + exe))
                    {
                        if (k == null) continue;
                        string p = k.GetValue(null) as string;
                        if (!string.IsNullOrEmpty(p) && File.Exists(p.Trim('"'))) return p.Trim('"');
                    }
                }
                catch (Exception) { }
            }
            return null;
        }

        private static string FirstExisting(params string[] paths)
        {
            foreach (string p in paths) if (!string.IsNullOrEmpty(p) && File.Exists(p)) return p;
            return null;
        }

        /// <summary>Returns the path of Edge or Chrome (as configured), or null to use the default browser.</summary>
        public static string FindBrowser(out string processName)
        {
            string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string pf86 = Environment.GetEnvironmentVariable("ProgramFiles(x86)") ?? pf;
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string edge = AppPath("msedge.exe") ?? FirstExisting(
                Path.Combine(pf86, "Microsoft\\Edge\\Application\\msedge.exe"),
                Path.Combine(pf, "Microsoft\\Edge\\Application\\msedge.exe"));
            string chrome = AppPath("chrome.exe") ?? FirstExisting(
                Path.Combine(pf, "Google\\Chrome\\Application\\chrome.exe"),
                Path.Combine(pf86, "Google\\Chrome\\Application\\chrome.exe"),
                Path.Combine(local, "Google\\Chrome\\Application\\chrome.exe"));

            string pref = Program.BrowserPref;
            string pick = null;
            if (pref == "default") pick = null;
            else if (pref == "chrome") pick = chrome ?? edge;
            else pick = edge ?? chrome;

            processName = pick == null ? null : Path.GetFileName(pick);
            return pick;
        }

        public static string ProfileDir()
        {
            string dir = Path.Combine(Program.Root, "browser-profile");
            Directory.CreateDirectory(dir);
            // Keep the browser from lingering in the background after the game window closes.
            string localState = Path.Combine(dir, "Local State");
            if (!File.Exists(localState))
            {
                try { File.WriteAllText(localState, "{\"background_mode\":{\"enabled\":false}}"); } catch (Exception) { }
            }
            return dir;
        }

        /// <summary>Opens the game. Returns the browser process when it can be tracked, otherwise null.</summary>
        public static Process OpenGameWindow(string url, bool track)
        {
            string procName;
            string browser = FindBrowser(out procName);
            if (browser != null)
            {
                string args = "--app=" + url +
                              " --user-data-dir=\"" + ProfileDir() + "\"" +
                              " --no-first-run --no-default-browser-check --start-maximized" +
                              " --disable-features=Translate";
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo(browser, args);
                    psi.UseShellExecute = false;
                    Process p = Process.Start(psi);
                    return track ? p : null;
                }
                catch (Exception e)
                {
                    Program.Log("browser start failed: " + e.Message);
                }
            }
            try { Process.Start(url); } catch (Exception e) { Program.Log("default browser failed: " + e.Message); }
            return null;
        }

        /// <summary>True while any browser process is using our dedicated profile folder.</summary>
        public static bool ProfileInUse(string processName)
        {
            if (string.IsNullOrEmpty(processName)) return false;
            string profile = ProfileDir().ToLowerInvariant();
            try
            {
                string query = "SELECT CommandLine FROM Win32_Process WHERE Name='" + processName.Replace("'", "") + "'";
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher(query))
                using (ManagementObjectCollection results = searcher.Get())
                {
                    foreach (ManagementBaseObject o in results)
                    {
                        string cmd = o["CommandLine"] as string;
                        if (cmd != null && cmd.ToLowerInvariant().Contains(profile)) return true;
                    }
                }
            }
            catch (Exception e)
            {
                Program.Log("process query failed: " + e.Message);
                return true; // when unsure, keep the server running
            }
            return false;
        }
    }

    /// <summary>The borderless, animated KEYSTORM splash window.</summary>
    internal sealed class Splash : Form
    {
        private const int W = 720;
        private const int H = 405;
        private static readonly Color Cyan = Color.FromArgb(95, 246, 255);
        private static readonly Color Violet = Color.FromArgb(138, 92, 255);
        private static readonly Color Ink = Color.FromArgb(233, 251, 255);
        private static readonly Color Muted = Color.FromArgb(143, 154, 196);
        private static readonly Color Dim = Color.FromArgb(93, 102, 144);
        private static readonly Color Danger = Color.FromArgb(255, 107, 133);

        public int ExitCode;

        private readonly float scale;
        private readonly Image art;
        private readonly Font fontStatus;
        private readonly Font fontDetail;
        private readonly Font fontSmall;
        private readonly System.Windows.Forms.Timer timer;
        private readonly Stopwatch clock = Stopwatch.StartNew();
        private readonly string statusFile;
        private Process core;
        private string node;

        private string stage = "starting";
        private string message = "Starting";
        private string detail = "";
        private string version = "";
        private double progress = -1;
        private double shownProgress;
        private double lastPoll;
        private double readyAt = -1;
        private bool failed;
        private bool closing;
        private int phase; // 0 preparing, 1 launching, 2 game open (hidden), 3 default-browser mode

        public Splash()
        {
            using (Graphics g = Graphics.FromHwnd(IntPtr.Zero)) scale = Math.Max(1f, g.DpiX / 96f);
            statusFile = Path.Combine(Program.Root, "status.json");

            Text = "KEYSTORM";
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.None;
            ClientSize = new Size(S(W), S(H));
            BackColor = Color.FromArgb(5, 5, 15);
            DoubleBuffered = true;
            KeyPreview = true;
            Opacity = 0;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }

            string artPath = Path.Combine(Program.Root, "launcher\\assets\\splash.png");
            try { if (File.Exists(artPath)) art = Image.FromFile(artPath); } catch (Exception) { art = null; }

            string family = HasFont("Bahnschrift") ? "Bahnschrift" : "Segoe UI";
            fontStatus = new Font(family, S(16), FontStyle.Bold, GraphicsUnit.Pixel);
            fontDetail = new Font(family, S(12), FontStyle.Regular, GraphicsUnit.Pixel);
            fontSmall = new Font(family, S(11), FontStyle.Regular, GraphicsUnit.Pixel);

            timer = new System.Windows.Forms.Timer();
            timer.Interval = 16;
            timer.Tick += OnTick;

            MouseDown += OnDrag;
            KeyDown += OnKey;
        }

        private int S(float v)
        {
            return (int)Math.Round(v * scale);
        }

        private static bool HasFont(string name)
        {
            foreach (FontFamily f in FontFamily.Families) if (string.Equals(f.Name, name, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ClassStyle |= 0x20000; // CS_DROPSHADOW
                return cp;
            }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            int round = 2; // DWMWCP_ROUND (Windows 11)
            int hr = -1;
            try { hr = Native.DwmSetWindowAttribute(Handle, 33, ref round, 4); } catch (Exception) { }
            if (hr != 0)
            {
                // Windows 10: clip to a rounded rectangle instead.
                using (GraphicsPath path = RoundRect(new Rectangle(0, 0, ClientSize.Width, ClientSize.Height), S(14)))
                    Region = new Region(path);
            }
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            timer.Start();
            StartCore();
        }

        // ------------------------------------------------------------------ core process

        private void StartCore()
        {
            failed = false;
            progress = -1;
            shownProgress = 0;
            SetStatus("starting", "Starting", "", -1);

            node = Launcher.FindNode();
            if (node == null)
            {
                Fail("Node.js is required", "Install Node.js 22 LTS from nodejs.org, then launch again.  \u00B7  N: open nodejs.org");
                return;
            }
            string script = Path.Combine(Program.Root, "launcher\\keystorm-core.mjs");
            if (!File.Exists(script))
            {
                Fail("Launcher files are missing", "Re-run Install-Keystorm.cmd to repair the installation.");
                return;
            }
            Program.TryDelete(statusFile);
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(node,
                    "\"" + script + "\" --root \"" + Program.Root + "\" --quiet --parent-pid " + Process.GetCurrentProcess().Id);
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WorkingDirectory = Program.Root;
                core = Process.Start(psi);
            }
            catch (Exception ex)
            {
                Fail("Could not start the updater", ex.Message);
            }
        }

        private void StopCore()
        {
            try
            {
                if (core != null && !core.HasExited) core.Kill();
            }
            catch (Exception) { }
        }

        private void PollStatus()
        {
            Dictionary<string, object> st = null;
            try
            {
                if (File.Exists(statusFile))
                {
                    string json;
                    using (FileStream fs = new FileStream(statusFile, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                    using (StreamReader r = new StreamReader(fs))
                        json = r.ReadToEnd();
                    st = new JavaScriptSerializer().DeserializeObject(json) as Dictionary<string, object>;
                }
            }
            catch (Exception) { st = null; }

            if (st != null)
            {
                string s = Str(st, "stage");
                double p = -1;
                object pv;
                if (st.TryGetValue("progress", out pv) && pv != null)
                {
                    try { p = Convert.ToDouble(pv); } catch (Exception) { p = -1; }
                }
                string v = Str(st, "version");
                if (v.Length > 0) version = v;

                if (s == "error")
                {
                    Fail(Str(st, "message"), Str(st, "detail"));
                    return;
                }
                SetStatus(s, Str(st, "message"), Str(st, "detail"), p);
                if (s == "ready" && phase == 0)
                {
                    phase = 1;
                    readyAt = clock.Elapsed.TotalSeconds;
                    gameUrl = Str(st, "url");
                    if (gameUrl.Length == 0) gameUrl = Launcher.GameUrl(Program.Port);
                    reused = Str(st, "reused") == "True";
                }
            }

            if (phase == 0 && !failed && core != null && core.HasExited && (st == null || Str(st, "stage") != "ready"))
            {
                Fail("The updater stopped unexpectedly", "Details are in " + Path.Combine(Program.Root, "logs\\core.log"));
            }
        }

        private string gameUrl = "";
        private bool reused;

        private static string Str(Dictionary<string, object> d, string key)
        {
            object v;
            if (d.TryGetValue(key, out v) && v != null) return Convert.ToString(v);
            return "";
        }

        private void SetStatus(string s, string msg, string det, double p)
        {
            stage = s;
            message = msg;
            detail = det;
            progress = p;
        }

        private void Fail(string msg, string det)
        {
            failed = true;
            StopCore();
            SetStatus("error", msg, det, -1);
            Program.Log("error: " + msg + " | " + det);
        }

        // ------------------------------------------------------------------ launching the game

        private void LaunchGame()
        {
            phase = 2;
            Process browser = Launcher.OpenGameWindow(gameUrl, true);
            string procName;
            string browserPath = Launcher.FindBrowser(out procName);

            if (reused)
            {
                // Another launcher owns the server; nothing to babysit.
                BeginClose();
                return;
            }
            if (browser == null || browserPath == null)
            {
                // Default browser: we can't see when the tab closes, so keep a small window around.
                phase = 3;
                SetStatus("running", "KEYSTORM is running in your browser", "Close this window (Esc) when you're done playing to stop the game server.", 1);
                return;
            }

            BeginClose(true);
            Thread watcher = new Thread(delegate ()
            {
                try
                {
                    browser.WaitForExit();
                    // The browser may hand the window to another process of the same profile; wait for all of them.
                    Thread.Sleep(1500);
                    while (Launcher.ProfileInUse(procName)) Thread.Sleep(2000);
                }
                catch (Exception e)
                {
                    Program.Log("watcher: " + e.Message);
                }
                try { BeginInvoke(new MethodInvoker(Shutdown)); } catch (Exception) { }
            });
            watcher.IsBackground = true;
            watcher.Start();
        }

        private bool hideOnly;

        /// <summary>Fade out. With hideOnly the process keeps running (to watch the game window).</summary>
        private void BeginClose(bool hide = false)
        {
            closing = true;
            hideOnly = hide;
        }

        private void Shutdown()
        {
            StopCore();
            timer.Stop();
            Close();
        }

        // ------------------------------------------------------------------ input

        private void OnKey(object sender, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Escape)
            {
                ExitCode = failed ? 1 : 0;
                Shutdown();
            }
            else if (failed && e.KeyCode == Keys.Enter)
            {
                StartCore();
            }
            else if (failed && e.KeyCode == Keys.L)
            {
                try { Process.Start(Path.Combine(Program.Root, "logs")); } catch (Exception) { }
            }
            else if (failed && e.KeyCode == Keys.N && node == null)
            {
                try { Process.Start("https://nodejs.org/en/download"); } catch (Exception) { }
            }
        }

        private void OnDrag(object sender, MouseEventArgs e)
        {
            if (e.Button != MouseButtons.Left) return;
            Native.ReleaseCapture();
            Native.SendMessage(Handle, 0xA1, (IntPtr)2, IntPtr.Zero); // WM_NCLBUTTONDOWN, HTCAPTION
        }

        // ------------------------------------------------------------------ frame

        private void OnTick(object sender, EventArgs e)
        {
            double t = clock.Elapsed.TotalSeconds;

            if (closing)
            {
                Opacity = Math.Max(0, Opacity - 0.08);
                if (Opacity <= 0)
                {
                    if (hideOnly)
                    {
                        Hide();
                        closing = false;
                    }
                    else Shutdown();
                    return;
                }
            }
            else if (Opacity < 1 && phase < 2)
            {
                Opacity = Math.Min(1, Opacity + 0.07);
            }

            if (phase == 0 && !failed && t - lastPoll > 0.1)
            {
                lastPoll = t;
                PollStatus();
            }
            if (phase == 1 && t - readyAt > 0.45) LaunchGame();

            double target = progress >= 0 ? progress : 0;
            shownProgress += (target - shownProgress) * 0.15;
            if (Visible) Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            Rectangle client = ClientRectangle;

            if (art != null) g.DrawImage(art, client);
            else
            {
                using (LinearGradientBrush bg = new LinearGradientBrush(client, Color.FromArgb(10, 8, 32), Color.FromArgb(5, 5, 15), 90f))
                    g.FillRectangle(bg, client);
                using (Font logo = new Font("Segoe UI", S(60), FontStyle.Bold, GraphicsUnit.Pixel))
                using (SolidBrush b = new SolidBrush(Cyan))
                {
                    StringFormat sf = new StringFormat();
                    sf.Alignment = StringAlignment.Center;
                    g.DrawString("KEYSTORM", logo, b, new RectangleF(0, S(100), client.Width, S(90)), sf);
                }
            }

            double t = clock.Elapsed.TotalSeconds;
            DrawStormFlicker(g, t);
            Color statusColor = failed ? Danger : Ink;
            using (SolidBrush b = new SolidBrush(statusColor)) g.DrawString(message, fontStatus, b, S(34), S(330));
            using (SolidBrush b = new SolidBrush(failed ? Color.FromArgb(220, 180, 190) : Muted))
            {
                RectangleF box = new RectangleF(S(35), S(353), S(W - 70), S(26));
                StringFormat sf = new StringFormat();
                sf.Trimming = StringTrimming.EllipsisCharacter;
                sf.FormatFlags = StringFormatFlags.NoWrap;
                g.DrawString(detail, fontDetail, b, box, sf);
            }

            string corner = failed ? "Enter: retry  \u00B7  L: logs  \u00B7  Esc: close" : (version.Length > 0 ? "build " + version : "Esc to cancel");
            using (SolidBrush b = new SolidBrush(Dim))
            {
                StringFormat sf = new StringFormat();
                sf.Alignment = StringAlignment.Far;
                g.DrawString(corner, fontSmall, b, new RectangleF(S(300), S(335), S(W - 336), S(20)), sf);
            }

            DrawBar(g, t);
        }

        /// <summary>The lightning in the artwork flashes now and then, lighting the clouds around it.</summary>
        private void DrawStormFlicker(Graphics g, double t)
        {
            double cycle = t % 3.7;
            if (cycle > 0.32) return;
            double a = cycle < 0.08 ? 1 : cycle < 0.14 ? 0.35 : cycle < 0.2 ? 0.8 : (0.32 - cycle) / 0.12 * 0.6;
            RectangleF glow = new RectangleF(S(560), S(-90), S(230), S(260));
            using (GraphicsPath path = new GraphicsPath())
            {
                path.AddEllipse(glow);
                using (PathGradientBrush b = new PathGradientBrush(path))
                {
                    b.CenterColor = Color.FromArgb((int)(90 * a), 190, 225, 255);
                    b.SurroundColors = new Color[] { Color.FromArgb(0, 120, 160, 255) };
                    g.FillPath(b, path);
                }
            }
        }

        private void DrawBar(Graphics g, double t)
        {
            float x = S(36);
            float y = S(383);
            float w = S(W - 72);
            float h = Math.Max(2, S(3));
            using (SolidBrush track = new SolidBrush(Color.FromArgb(40, 255, 255, 255))) g.FillRectangle(track, x, y, w, h);
            if (failed)
            {
                using (SolidBrush b = new SolidBrush(Danger)) g.FillRectangle(b, x, y, w, h);
                return;
            }

            float fx;
            float fw;
            bool complete = stage == "ready" || stage == "running" || stage == "done";
            if (complete) shownProgress = Math.Max(shownProgress, 0.98);
            if (progress >= 0 || complete)
            {
                fx = x;
                fw = (float)(w * Math.Max(0.02, Math.Min(1, complete ? 1 : shownProgress)));
            }
            else
            {
                // Indeterminate: a comet sweeping across the track.
                double p = (t * 0.55) % 1.0;
                double ease = p < 0.5 ? 2 * p * p : 1 - Math.Pow(-2 * p + 2, 2) / 2;
                fw = S(180);
                fx = (float)(x - fw + (w + fw) * ease);
            }
            RectangleF seg = RectangleF.Intersect(new RectangleF(fx, y - S(6), fw, h + S(12)), new RectangleF(x, y - S(6), w, h + S(12)));
            if (seg.Width <= 1) return;

            // Glow
            using (LinearGradientBrush glow = new LinearGradientBrush(new RectangleF(fx - 1, y, fw + 2, h), Color.FromArgb(0, Cyan), Color.FromArgb(70, Cyan), 0f))
            {
                if (progress >= 0 || complete) glow.LinearColors = new Color[] { Color.FromArgb(50, Cyan), Color.FromArgb(80, Violet) };
                g.FillRectangle(glow, seg.X, y - S(3), seg.Width, h + S(6));
            }
            // Core line
            using (LinearGradientBrush core = new LinearGradientBrush(new RectangleF(fx - 1, y, fw + 2, h), Cyan, Violet, 0f))
            {
                if (progress < 0 && !complete)
                {
                    ColorBlend blend = new ColorBlend(3);
                    blend.Colors = new Color[] { Color.FromArgb(0, Cyan), Cyan, Color.FromArgb(255, 255, 255) };
                    blend.Positions = new float[] { 0f, 0.75f, 1f };
                    core.InterpolationColors = blend;
                }
                g.FillRectangle(core, seg.X, y, seg.Width, h);
            }
        }

        private static GraphicsPath RoundRect(Rectangle r, int radius)
        {
            GraphicsPath p = new GraphicsPath();
            int d = radius * 2;
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            StopCore();
            base.OnFormClosed(e);
        }
    }
}
