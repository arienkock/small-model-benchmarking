// keepwarm — keep llama-server's model in RAM while the persona is idle.
//
// Windows trims an idle process's working set; with --load-mode none the model
// is ~24 GiB of private memory, so after a few quiet minutes most of it sat on
// the low-priority standby list or in the pagefile, and the next turn paged it
// back in at 3-6 tokens/s instead of 11-13 (2026-09-26). Reading the pages from
// here puts them back in llama-server's working set and marks them recently
// used, without touching llama-server's state (its KV cache, the slot).
//
// It also raises llama-server to normal priority and normal memory priority:
// started from the PersonaServer task (Task Scheduler priority 7) it inherits
// below-normal, whose trimmed pages are the first to be repurposed.
//
//   keepwarm.exe [pid]    one pass over llama-server.exe (or pid); prints one JSON line
//
// Skips write-combined / uncached memory (CUDA staging buffers: slow to read,
// never paged) and anything not committed, private and readable.
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

static class KeepWarm {
	[StructLayout(LayoutKind.Sequential)]
	struct MBI {
		public IntPtr BaseAddress, AllocationBase;
		public uint AllocationProtect, Pad0;
		public IntPtr RegionSize;
		public uint State, Protect, Type, Pad1;
	}

	[DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
	[DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr VirtualQueryEx(IntPtr h, IntPtr addr, out MBI mbi, IntPtr len);
	[DllImport("kernel32.dll", SetLastError = true)] static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, IntPtr size, out IntPtr read);
	[DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessInformation(IntPtr h, int cls, ref uint info, int size);
	[DllImport("kernel32.dll", SetLastError = true)] static extern bool SetProcessInformation(IntPtr h, int cls, ref uint info, int size);
	[DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

	const uint VM_READ = 0x10, SET_INFORMATION = 0x200, QUERY_INFORMATION = 0x400;
	const uint MEM_COMMIT = 0x1000, MEM_PRIVATE = 0x20000;
	const uint PAGE_NOACCESS = 0x01, PAGE_GUARD = 0x100, PAGE_NOCACHE = 0x200, PAGE_WRITECOMBINE = 0x400;
	const int ProcessMemoryPriority = 0;
	const uint MEMORY_PRIORITY_NORMAL = 5;

	static int Main(string[] args) {
		Process p;
		if (args.Length > 0) p = Process.GetProcessById(int.Parse(args[0]));
		else {
			var all = Process.GetProcessesByName("llama-server");
			if (all.Length == 0) { Console.WriteLine("{\"error\":\"no llama-server running\"}"); return 2; }
			p = all[0];
		}
		var sw = Stopwatch.StartNew();
		long wsBefore = p.WorkingSet64;
		IntPtr h = OpenProcess(VM_READ | QUERY_INFORMATION | SET_INFORMATION, false, p.Id);
		if (h == IntPtr.Zero) { Console.WriteLine("{\"error\":\"OpenProcess failed: " + Marshal.GetLastWin32Error() + "\"}"); return 1; }
		try {
			string prio = p.PriorityClass.ToString();
			if (p.PriorityClass != ProcessPriorityClass.Normal) p.PriorityClass = ProcessPriorityClass.Normal;
			uint memPrio = 0;
			GetProcessInformation(h, ProcessMemoryPriority, ref memPrio, 4);
			uint want = MEMORY_PRIORITY_NORMAL;
			if (memPrio != want) SetProcessInformation(h, ProcessMemoryPriority, ref want, 4);

			var buf = new byte[1 << 20];
			long read = 0, regions = 0;
			IntPtr addr = IntPtr.Zero;
			MBI m;
			int mbiSize = Marshal.SizeOf(typeof(MBI));
			while (VirtualQueryEx(h, addr, out m, (IntPtr)mbiSize) != IntPtr.Zero) {
				long size = m.RegionSize.ToInt64();
				bool readable = (m.Protect & (PAGE_NOACCESS | PAGE_GUARD | PAGE_NOCACHE | PAGE_WRITECOMBINE)) == 0 && m.Protect != 0;
				if (m.State == MEM_COMMIT && m.Type == MEM_PRIVATE && readable) {
					regions++;
					for (long off = 0; off < size; off += buf.Length) {
						long n = Math.Min(buf.Length, size - off);
						IntPtr got;
						if (ReadProcessMemory(h, (IntPtr)(m.BaseAddress.ToInt64() + off), buf, (IntPtr)n, out got)) read += got.ToInt64();
					}
				}
				long next = m.BaseAddress.ToInt64() + size;
				if (next <= addr.ToInt64()) break;
				addr = (IntPtr)next;
			}
			p.Refresh();
			Console.WriteLine(string.Format(
				"{{\"pid\":{0},\"readGiB\":{1:F2},\"regions\":{2},\"seconds\":{3:F2},\"wsBeforeGiB\":{4:F2},\"wsAfterGiB\":{5:F2},\"priority\":\"{6}\",\"memoryPriority\":{7}}}",
				p.Id, read / 1073741824.0, regions, sw.Elapsed.TotalSeconds, wsBefore / 1073741824.0, p.WorkingSet64 / 1073741824.0, prio, memPrio));
			return 0;
		} finally { CloseHandle(h); }
	}
}
