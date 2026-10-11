using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Stremio Phone Remote")]
[assembly: AssemblyDescription("Local phone remote for the Stremio desktop player")]
[assembly: AssemblyProduct("Stremio Phone Remote")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace StremioRemoteDesktop
{
    public sealed class DashboardDevice
    {
        public string id { get; set; }
        public string name { get; set; }
        public string lastSeenAt { get; set; }
        public bool online { get; set; }
    }

    public sealed class DashboardState
    {
        public int port { get; set; }
        public int bridgePort { get; set; }
        public string pin { get; set; }
        public bool playerConnected { get; set; }
        public string primaryUrl { get; set; }
        public string[] urls { get; set; }
        public bool[][] qrMatrix { get; set; }
        public DashboardDevice[] devices { get; set; }
    }

    public sealed class RemoteForm : Form
    {
        private const int Port = 9100;
        private const int BridgePort = 9101;
        private readonly string baseDirectory = AppDomain.CurrentDomain.BaseDirectory;
        private readonly Label statusLabel = new Label();
        private readonly Label pinLabel = new Label();
        private readonly Label linkLabel = new Label();
        private readonly PictureBox qrPicture = new PictureBox();
        private readonly ListView devicesList = new ListView();
        private readonly Timer refreshTimer = new Timer();
        private DashboardState dashboard;
        private Process serverProcess;
        private bool ownsServer;

        public RemoteForm()
        {
            Text = "Stremio Phone Remote";
            ClientSize = new Size(880, 660);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(14, 10, 20);
            ForeColor = Color.White;
            Font = new Font("Segoe UI", 10F);

            var title = new Label { Text = "STREMIO PHONE REMOTE", Left = 28, Top = 24, Width = 520, Height = 34, Font = new Font("Segoe UI", 20F, FontStyle.Bold), ForeColor = Color.FromArgb(187, 160, 255) };
            statusLabel.SetBounds(31, 62, 600, 28);
            statusLabel.ForeColor = Color.FromArgb(143, 226, 177);

            var connectionGroup = Panel(28, 104, 824, 235);
            var instructions = new Label {
                Text = "HOW TO CONNECT\r\n\r\n1. Keep your computer and phone on the same Wi-Fi network.\r\n2. Scan the QR code or open the address on your phone.\r\n3. Enter the pairing PIN once. This device will stay paired.",
                Left = 22, Top = 18, Width = 510, Height = 112, ForeColor = Color.FromArgb(216, 205, 230)
            };
            pinLabel.SetBounds(22, 145, 500, 64);
            pinLabel.Text = "PAIRING PIN: Loading…";
            pinLabel.Font = new Font("Consolas", 22F, FontStyle.Bold);
            pinLabel.ForeColor = Color.White;
            pinLabel.BackColor = Color.FromArgb(83, 48, 150);
            pinLabel.BorderStyle = BorderStyle.FixedSingle;
            pinLabel.TextAlign = ContentAlignment.MiddleCenter;
            qrPicture.SetBounds(590, 14, 205, 205);
            qrPicture.SizeMode = PictureBoxSizeMode.Zoom;
            connectionGroup.Controls.Add(instructions);
            connectionGroup.Controls.Add(pinLabel);
            connectionGroup.Controls.Add(qrPicture);

            linkLabel.SetBounds(31, 354, 570, 30);
            linkLabel.ForeColor = Color.FromArgb(185, 174, 199);
            var copyButton = Button("Copy link", 612, 348, 112, 38);
            copyButton.Click += delegate {
                try { if (dashboard != null && !string.IsNullOrEmpty(dashboard.primaryUrl)) Clipboard.SetText(dashboard.primaryUrl); }
                catch (Exception error) { MessageBox.Show("The link could not be copied: " + error.Message, "Stremio Phone Remote"); }
            };
            var openButton = Button("Open remote", 732, 348, 120, 38);
            openButton.Click += delegate { if (dashboard != null && !string.IsNullOrEmpty(dashboard.primaryUrl)) Process.Start(dashboard.primaryUrl); };

            var devicesTitle = new Label { Text = "PAIRED DEVICES", Left = 31, Top = 411, Width = 400, Height = 28, Font = new Font("Segoe UI", 11F, FontStyle.Bold), ForeColor = Color.FromArgb(187, 160, 255) };
            devicesList.SetBounds(28, 444, 696, 155);
            devicesList.View = View.Details;
            devicesList.FullRowSelect = true;
            devicesList.HideSelection = false;
            devicesList.BackColor = Color.FromArgb(25, 17, 32);
            devicesList.ForeColor = Color.White;
            devicesList.BorderStyle = BorderStyle.FixedSingle;
            devicesList.Columns.Add("Device", 300);
            devicesList.Columns.Add("Status", 150);
            devicesList.Columns.Add("Last seen", 220);
            var unlinkButton = Button("Unpair", 736, 444, 116, 42);
            unlinkButton.Click += UnlinkSelected;
            var stremioButton = Button("Open Stremio", 736, 497, 116, 42);
            stremioButton.Click += delegate { LaunchStremio(false); };
            var refreshButton = Button("Refresh", 736, 550, 116, 42);
            refreshButton.Click += delegate { RefreshDashboard(); };

            var footer = new Label { Text = "Ports: remote 9100 · player bridge 9101   |   Closing this window stops only the phone remote.", Left = 31, Top = 620, Width = 810, Height = 28, ForeColor = Color.FromArgb(143, 131, 154) };

            Controls.Add(title);
            Controls.Add(statusLabel);
            Controls.Add(connectionGroup);
            Controls.Add(linkLabel);
            Controls.Add(copyButton);
            Controls.Add(openButton);
            Controls.Add(devicesTitle);
            Controls.Add(devicesList);
            Controls.Add(unlinkButton);
            Controls.Add(stremioButton);
            Controls.Add(refreshButton);
            Controls.Add(footer);

            Shown += delegate { StartEverything(); };
            FormClosing += delegate { StopOwnedServer(); };
            refreshTimer.Interval = 1200;
            refreshTimer.Tick += delegate { RefreshDashboard(); };
        }

        private Panel Panel(int left, int top, int width, int height)
        {
            return new Panel { Left = left, Top = top, Width = width, Height = height, BackColor = Color.FromArgb(31, 23, 42), BorderStyle = BorderStyle.FixedSingle };
        }

        private Button Button(string text, int left, int top, int width, int height)
        {
            return new Button { Text = text, Left = left, Top = top, Width = width, Height = height, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(113, 61, 237), ForeColor = Color.White, FlatAppearance = { BorderSize = 0 } };
        }

        private void StartEverything()
        {
            try
            {
                if (!DashboardAvailable()) StartServer();
                LaunchStremio(true);
                refreshTimer.Start();
                RefreshDashboard();
            }
            catch (Exception error)
            {
                statusLabel.Text = "Startup failed";
                statusLabel.ForeColor = Color.FromArgb(255, 157, 175);
                MessageBox.Show(error.Message, "Stremio Phone Remote", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private bool DashboardAvailable()
        {
            try
            {
                DownloadDashboard();
                return true;
            }
            catch { return false; }
        }

        private void StartServer()
        {
            var node = Path.Combine(baseDirectory, "runtime", "node.exe");
            var server = Path.Combine(baseDirectory, "remote-server", "server.js");
            if (!File.Exists(node)) throw new FileNotFoundException("The bundled remote runtime was not found.", node);
            if (!File.Exists(server)) throw new FileNotFoundException("The remote server was not found.", server);

            var start = new ProcessStartInfo(node, "remote-server/server.js");
            start.WorkingDirectory = baseDirectory;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.WindowStyle = ProcessWindowStyle.Hidden;
            start.EnvironmentVariables["STREMIO_REMOTE_PORT"] = Port.ToString();
            start.EnvironmentVariables["STREMIO_STREAM_PROXY_PORT"] = BridgePort.ToString();
            start.EnvironmentVariables["STREMIO_REMOTE_HEADLESS"] = "1";
            serverProcess = Process.Start(start);
            ownsServer = true;

            for (var attempt = 0; attempt < 30; attempt++)
            {
                System.Threading.Thread.Sleep(200);
                if (DashboardAvailable()) return;
                if (serverProcess.HasExited) throw new InvalidOperationException("The remote server exited during startup.");
            }
            throw new TimeoutException("The remote server took too long to start.");
        }

        private string FindStremio()
        {
            var bundled = Path.Combine(baseDirectory, "stremio", "stremio-shell-ng.exe");
            if (File.Exists(bundled)) return bundled;

            var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            var programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            var candidates = new[] {
                Path.Combine(local, "Programs", "Stremio", "stremio-shell-ng.exe"),
                Path.Combine(local, "Programs", "LNV", "Stremio-5", "Stremio.exe"),
                Path.Combine(local, "Programs", "LNV", "Stremio-4", "stremio.exe"),
                Path.Combine(programFiles, "Stremio", "stremio-shell-ng.exe"),
                Path.Combine(programFilesX86, "Stremio", "stremio-shell-ng.exe")
            };
            var standardPath = candidates.FirstOrDefault(File.Exists);
            if (!string.IsNullOrEmpty(standardPath)) return standardPath;

            foreach (var executableName in new[] { "stremio-shell-ng.exe", "stremio.exe", "Stremio.exe" })
            {
                var appPath = ReadAppPath(Registry.CurrentUser, executableName) ?? ReadAppPath(Registry.LocalMachine, executableName);
                if (!string.IsNullOrEmpty(appPath) && File.Exists(appPath)) return appPath;
            }
            return null;
        }

        private string ReadAppPath(RegistryKey root, string executableName)
        {
            try
            {
                using (var key = root.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\App Paths\" + executableName))
                    return key == null ? null : key.GetValue(null) as string;
            }
            catch { return null; }
        }

        private void LaunchStremio(bool automatic)
        {
            var stremio = FindStremio();
            if (string.IsNullOrEmpty(stremio))
            {
                MessageBox.Show("The bundled Stremio Desktop executable was not found. Reinstall Stremio Phone Remote and try again.", "Stremio Phone Remote", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            var running = Process.GetProcessesByName("stremio-shell-ng").Concat(Process.GetProcessesByName("stremio")).ToArray();
            if (running.Length > 0)
            {
                var bundledAlreadyRunning = running.Any((process) =>
                {
                    try { return string.Equals(process.MainModule.FileName, stremio, StringComparison.OrdinalIgnoreCase); }
                    catch { return false; }
                });
                if (bundledAlreadyRunning)
                {
                    if (!automatic) MessageBox.Show("The bundled Stremio instance is already running.", "Stremio Phone Remote");
                }
                else
                {
                    MessageBox.Show("Another Stremio installation is running. Close it, then click “Open Stremio” to start the bundled version.", "Stremio Phone Remote", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
                return;
            }
            var proxyUrl = Uri.EscapeDataString("http://127.0.0.1:" + BridgePort);
            var webUiUrl = "http://127.0.0.1:" + Port + "/#/?loginFlow=desktop&streamingServerUrl=" + proxyUrl;
            Process.Start(stremio, "--webui-url=\"" + webUiUrl + "\"");
        }

        private void RefreshDashboard()
        {
            try
            {
                var json = DownloadDashboard();
                dashboard = new JavaScriptSerializer().Deserialize<DashboardState>(json);
                statusLabel.Text = dashboard.playerConnected ? "● Player connected" : "● Remote active · waiting for the player";
                statusLabel.ForeColor = dashboard.playerConnected ? Color.FromArgb(143, 226, 177) : Color.FromArgb(197, 186, 207);
                pinLabel.Text = "PAIRING PIN: " + dashboard.pin;
                linkLabel.Text = dashboard.primaryUrl;
                var previousQr = qrPicture.Image;
                qrPicture.Image = RenderQr(dashboard.qrMatrix);
                if (previousQr != null) previousQr.Dispose();
                RenderDevices();
            }
            catch
            {
                statusLabel.Text = "● Remote server disconnected";
                statusLabel.ForeColor = Color.FromArgb(255, 157, 175);
                pinLabel.Text = "PAIRING PIN: Unavailable";
            }
        }

        private string DownloadDashboard()
        {
            var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + Port + "/api/dashboard");
            request.Timeout = 1000;
            request.ReadWriteTimeout = 1000;
            request.CachePolicy = new System.Net.Cache.RequestCachePolicy(System.Net.Cache.RequestCacheLevel.NoCacheNoStore);
            using (var response = (HttpWebResponse)request.GetResponse())
            using (var stream = response.GetResponseStream())
            using (var reader = new StreamReader(stream, Encoding.UTF8))
                return reader.ReadToEnd();
        }

        private Bitmap RenderQr(bool[][] matrix)
        {
            if (matrix == null || matrix.Length == 0) return null;
            const int quiet = 4;
            const int scale = 6;
            var size = (matrix.Length + quiet * 2) * scale;
            var bitmap = new Bitmap(size, size);
            using (var graphics = Graphics.FromImage(bitmap))
            {
                graphics.Clear(Color.White);
                using (var brush = new SolidBrush(Color.Black))
                {
                    for (var row = 0; row < matrix.Length; row++)
                        for (var column = 0; column < matrix[row].Length; column++)
                            if (matrix[row][column]) graphics.FillRectangle(brush, (column + quiet) * scale, (row + quiet) * scale, scale, scale);
                }
            }
            return bitmap;
        }

        private void RenderDevices()
        {
            devicesList.BeginUpdate();
            devicesList.Items.Clear();
            foreach (var device in dashboard.devices ?? new DashboardDevice[0])
            {
                DateTime lastSeen;
                var last = DateTime.TryParse(device.lastSeenAt, out lastSeen) ? lastSeen.ToLocalTime().ToString("g") : "—";
                var item = new ListViewItem(new[] { device.name, device.online ? "ONLINE" : "Offline", last });
                item.Tag = device.id;
                if (device.online) item.ForeColor = Color.FromArgb(143, 226, 177);
                devicesList.Items.Add(item);
            }
            devicesList.EndUpdate();
        }

        private void UnlinkSelected(object sender, EventArgs eventArgs)
        {
            if (devicesList.SelectedItems.Count == 0) { MessageBox.Show("Select a device first.", "Stremio Phone Remote"); return; }
            var item = devicesList.SelectedItems[0];
            if (MessageBox.Show("Unpair " + item.Text + "?", "Stremio Phone Remote", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            try
            {
                using (var client = new WebClient()) client.UploadString("http://127.0.0.1:" + Port + "/api/devices/" + Uri.EscapeDataString((string)item.Tag), "DELETE", "");
                RefreshDashboard();
            }
            catch (Exception error) { MessageBox.Show("The device could not be unpaired: " + error.Message, "Stremio Phone Remote"); }
        }

        private void StopOwnedServer()
        {
            refreshTimer.Stop();
            if (ownsServer && serverProcess != null && !serverProcess.HasExited)
            {
                try { serverProcess.Kill(); } catch { }
            }
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            bool isFirstInstance;
            using (var mutex = new System.Threading.Mutex(true, @"Local\StremioPhoneRemote", out isFirstInstance))
            {
                if (!isFirstInstance)
                {
                    MessageBox.Show("Stremio Phone Remote is already running.", "Stremio Phone Remote", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new RemoteForm());
                GC.KeepAlive(mutex);
            }
        }
    }
}
