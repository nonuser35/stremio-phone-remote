using System;
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
                Process.Start(executable);
                MessageBox.Show("Stremio Phone Remote is installed. A desktop shortcut has been created.", "Installation complete", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception error)
            {
                MessageBox.Show("Installation failed:\r\n\r\n" + error.Message, "Stremio Phone Remote", MessageBoxButtons.OK, MessageBoxIcon.Error);
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
