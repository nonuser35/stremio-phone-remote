using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("Stremio Phone Remote Installer")]
[assembly: AssemblyDescription("Installer for Stremio Phone Remote")]
[assembly: AssemblyProduct("Stremio Phone Remote")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace StremioRemoteInstaller
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            var source = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            var target = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "StremioRemote");
            try
            {
                if (Process.GetProcessesByName("Stremio Remote").Length > 0)
                {
                    MessageBox.Show("Close Stremio Phone Remote before updating it, then run this installer again.", "Stremio Phone Remote", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
                if (!string.Equals(source, target, StringComparison.OrdinalIgnoreCase)) CopyDirectory(source, target);
                var executable = Path.Combine(target, "Stremio Remote.exe");
                if (!File.Exists(executable)) throw new FileNotFoundException("Stremio Remote.exe was not found in the package.");
                CreateShortcut(executable);
                var firewallReady = EnsurePrivateNetworkAccess(target);
                Process.Start(executable);
                var message = firewallReady
                    ? "Stremio Phone Remote is installed. A desktop shortcut has been created and phone access is allowed on private networks."
                    : "Stremio Phone Remote is installed, but Windows Firewall access was not enabled. The remote may not open on your phone until you run the installer again and approve the administrator prompt.";
                MessageBox.Show(message, "Installation complete", MessageBoxButtons.OK, firewallReady ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
            }
            catch (Exception error)
            {
                MessageBox.Show("Installation failed:\r\n\r\n" + error.Message, "Stremio Phone Remote", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private static bool EnsurePrivateNetworkAccess(string target)
        {
            var node = Path.Combine(target, "runtime", "node.exe");
            if (!File.Exists(node)) throw new FileNotFoundException("The bundled Node.js runtime was not found in the package.", node);

            var ruleName = "Stremio Phone Remote (TCP 9100)";
            var check = new ProcessStartInfo("netsh.exe", "advfirewall firewall show rule name=\"" + ruleName + "\"")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            using (var existingRule = Process.Start(check))
            {
                existingRule.WaitForExit();
                if (existingRule.ExitCode == 0) return true;
            }

            var arguments = "advfirewall firewall add rule name=\"" + ruleName + "\" dir=in action=allow program=\"" + node + "\" protocol=TCP localport=9100 profile=private enable=yes";
            try
            {
                var start = new ProcessStartInfo("netsh.exe", arguments)
                {
                    UseShellExecute = true,
                    Verb = "runas",
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                using (var process = Process.Start(start))
                {
                    process.WaitForExit();
                    return process.ExitCode == 0;
                }
            }
            catch (Win32Exception error)
            {
                // Error 1223 means the user cancelled the UAC prompt.
                if (error.NativeErrorCode == 1223) return false;
                throw;
            }
        }

        private static void CopyDirectory(string source, string target)
        {
            Directory.CreateDirectory(target);
            foreach (var directory in Directory.GetDirectories(source, "*", SearchOption.AllDirectories))
            {
                var relative = directory.Substring(source.Length).TrimStart(Path.DirectorySeparatorChar);
                Directory.CreateDirectory(Path.Combine(target, relative));
            }
            foreach (var file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
            {
                var relative = file.Substring(source.Length).TrimStart(Path.DirectorySeparatorChar);
                if (relative.Equals("remote-server\\remote-devices.json", StringComparison.OrdinalIgnoreCase)) continue;
                var destination = Path.Combine(target, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(destination));
                File.Copy(file, destination, true);
            }
        }

        private static void CreateShortcut(string executable)
        {
            var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            var shortcutPath = Path.Combine(desktop, "Stremio Remote.lnk");
            var shellType = Type.GetTypeFromProgID("WScript.Shell");
            dynamic shell = Activator.CreateInstance(shellType);
            dynamic shortcut = shell.CreateShortcut(shortcutPath);
            shortcut.TargetPath = executable;
            shortcut.WorkingDirectory = Path.GetDirectoryName(executable);
            shortcut.IconLocation = executable + ",0";
            shortcut.Description = "Open Stremio and control playback from your phone";
            shortcut.Save();
        }
    }
}
