// Demo-only stand-in for the GitHub CLI. It never talks to GitHub.
//   gh search prs ...        -> prints prs.json (edit that file while Claude Code runs to add a new request)
//   gh pr review ...         -> logs the action and any stdin body to fake-gh.log, exits 0
//   gh pr view <url> --web   -> logs it, exits 0 (opens no browser)
using System;
using System.IO;
using System.Text;

static class FakeGh
{
    static int Main(string[] args)
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string log = Path.Combine(dir, "fake-gh.log");
        string line = DateTime.Now.ToString("s") + "  gh " + string.Join(" ", args);

        if (args.Length >= 2 && args[0] == "search" && args[1] == "prs")
        {
            Console.Out.Write(File.ReadAllText(Path.Combine(dir, "prs.json")));
            return 0;
        }

        if (args.Length >= 2 && args[0] == "pr" && args[1] == "review")
        {
            string body = Array.IndexOf(args, "--body-file") >= 0 ? Console.In.ReadToEnd() : "";
            File.AppendAllText(log, line + (body.Length > 0 ? "\n  body: " + body : "") + "\n", Encoding.UTF8);
            return 0;
        }

        if (args.Length >= 2 && args[0] == "pr" && args[1] == "view")
        {
            File.AppendAllText(log, line + "\n", Encoding.UTF8);
            return 0;
        }

        Console.Error.WriteLine("fake gh: unsupported command: " + string.Join(" ", args));
        return 1;
    }
}
