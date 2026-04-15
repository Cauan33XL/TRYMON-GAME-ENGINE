//! TVM Syscall Bridge
//!
//! Maps Linux syscalls to browser/WASM equivalents for the TVM to execute
//! native-like programs in the browser environment.

use super::vm::TVM;
use crate::error::{KernelError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Syscall numbers (Linux x86_64 compatible)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Syscall {
    /// read(fd, buf, count)
    Read = 0,
    /// write(fd, buf, count)  
    Write = 1,
    /// open(path, flags, mode)
    Open = 2,
    /// close(fd)
    Close = 3,
    /// stat(path, statbuf)
    Stat = 4,
    /// fstat(fd, statbuf)
    Fstat = 5,
    /// lstat(path, statbuf)
    Lstat = 6,
    /// poll(fds, nfds, timeout)
    Poll = 7,
    /// lseek(fd, offset, whence)
    Lseek = 8,
    /// mmap(addr, length, prot, flags, fd, offset)
    Mmap = 9,
    /// mprotect(addr, len, prot)
    Mprotect = 10,
    /// munmap(addr, len)
    Munmap = 11,
    /// brk(addr)
    Brk = 12,
    /// rt_sigaction(signum, act, oldact)
    RtSigaction = 13,
    /// rt_sigprocmask(how, set, oldset)
    RtSigprocmask = 14,
    /// rt_sigreturn()
    RtSigreturn = 15,
    /// sigaction(signum, act, oldact)
    Sigaction = 16,
    /// sigprocmask(how, set, oldset)
    Sigprocmask = 17,
    /// sigaltstack(ss, oldss)
    Sigaltstack = 18,
    /// ioctl(fd, request, arg)
    Ioctl = 19,
    /// readv(fd, iov, iovcnt)
    Readv = 20,
    /// writev(fd, iov, iovcnt)
    Writev = 21,
    /// access(path, mode)
    Access = 22,
    /// pipe(pipefd)
    Pipe = 23,
    /// select(n, readfds, writefds, exceptfds, timeout)
    Select = 24,
    /// sched_yield()
    SchedYield = 25,
    /// mremap(old_address, old_size, new_size, flags)
    Mremap = 26,
    /// msync(addr, len, flags)
    Msync = 27,
    /// mincore(addr, len, vec)
    Mincore = 28,
    /// madvise(addr, len, advice)
    Madvise = 29,
    /// shmget(key, size, shmflg)
    Shmget = 30,
    /// shmat(shmid, shmaddr, shmflg)
    Shmat = 31,
    /// shmctl(shmid, cmd, buf)
    Shmctl = 32,
    /// dup(fd)
    Dup = 33,
    /// dup2(oldfd, newfd)
    Dup2 = 34,
    /// pause()
    Pause = 35,
    /// nanosleep(req, rem)
    Nanosleep = 36,
    /// getpid()
    Getpid = 37,
    /// socket(domain, type, protocol)
    Socket = 38,
    /// connect(sockfd, addr, addrlen)
    Connect = 39,
    /// accept(sockfd, addr, addrlen)
    Accept = 40,
    /// sendto(sockfd, buf, len, flags, dest_addr, addrlen)
    Sendto = 41,
    /// recvfrom(sockfd, buf, len, flags, src_addr, addrlen)
    Recvfrom = 42,
    /// sendmsg(sockfd, msg, flags)
    Sendmsg = 43,
    /// recvmsg(sockfd, msg, flags)
    Recvmsg = 44,
    /// shutdown(sockfd, how)
    Shutdown = 45,
    /// bind(sockfd, addr, addrlen)
    Bind = 46,
    /// listen(sockfd, backlog)
    Listen = 47,
    /// getsockname(sockfd, addr, addrlen)
    Getsockname = 48,
    /// getpeername(sockfd, addr, addrlen)
    Getpeername = 49,
    /// socketpair(domain, type, protocol, sv)
    Socketpair = 50,
    /// setsockopt(sockfd, level, optname, optval, optlen)
    Setsockopt = 51,
    /// getsockopt(sockfd, level, optname, optval, optlen)
    Getsockopt = 52,
    /// clone(flags, child_stack, parent_tid, child_tid, tls)
    Clone = 56,
    /// fork()
    Fork = 57,
    /// vfork()
    Vfork = 58,
    /// execve(path, argv, envp)
    Execve = 59,
    /// exit(status)
    Exit = 60,
    /// wait4(pid, wstatus, options, rusage)
    Wait4 = 61,
    /// kill(pid, sig)
    Kill = 62,
    /// uname(buf)
    Uname = 63,
    /// semget(key, nsems, semflg)
    Semget = 64,
    /// semop(semid, sop, nsops)
    Semop = 65,
    /// semctl(semid, semnum, cmd, arg)
    Semctl = 66,
    /// shmdt(shmaddr)
    Shmdt = 67,
    /// msgget(key, msgflg)
    Msgget = 68,
    /// msgsnd(msqid, msgp, msgsz, msgflg)
    Msgsnd = 69,
    /// msgrcv(msqid, msgp, msgsz, msgtyp, msgflg)
    Msgrcv = 70,
    /// msgctl(msqid, cmd, buf)
    Msgctl = 71,
    /// fcntl(fd, cmd, arg)
    Fcntl = 72,
    /// flock(fd, operation)
    Flock = 73,
    /// fsync(fd)
    Fsync = 74,
    /// fdatasync(fd)
    Fdatasync = 75,
    /// truncate(path, length)
    Truncate = 76,
    /// ftruncate(fd, length)
    Ftruncate = 77,
    /// getdents(fd, dirent, count)
    Getdents = 78,
    /// getcwd(buf, size)
    Getcwd = 79,
    /// chdir(path)
    Chdir = 80,
    /// fchdir(fd)
    Fchdir = 81,
    /// rename(oldpath, newpath)
    Rename = 82,
    /// mkdir(path, mode)
    Mkdir = 83,
    /// rmdir(path)
    Rmdir = 84,
    /// creat(path, mode)
    Creat = 85,
    /// link(oldpath, newpath)
    Link = 86,
    /// unlink(path)
    Unlink = 87,
    /// symlink(target, linkpath)
    Symlink = 88,
    /// readlink(path, buf, bufsiz)
    Readlink = 89,
    /// chmod(path, mode)
    Chmod = 90,
    /// fchmod(fd, mode)
    Fchmod = 91,
    /// chown(path, owner, group)
    Chown = 92,
    /// fchown(fd, owner, group)
    Fchown = 93,
    /// lchown(path, owner, group)
    Lchown = 94,
    /// umask(mask)
    Umask = 95,
    /// gettimeofday(tv, tz)
    Gettimeofday = 96,
    /// getrlimit(resource, rlim)
    Getrlimit = 97,
    /// getrusage(who, rusage)
    Getrusage = 98,
    /// sysinfo(info)
    Sysinfo = 99,
    /// times(tms)
    Times = 100,
    /// ptrace(request, pid, addr, data)
    Ptrace = 101,
    /// getuid()
    Getuid = 102,
    /// syslog(type, buf, len)
    Syslog = 103,
    /// getgid()
    Getgid = 104,
    /// setuid(uid)
    Setuid = 105,
    /// setgid(gid)
    Setgid = 106,
    /// geteuid()
    Geteuid = 107,
    /// getegid()
    Getegid = 108,
    /// setpgid(pid, pgid)
    Setpgid = 109,
    /// getppid()
    Getppid = 110,
    /// getpgrp()
    Getpgrp = 111,
    /// setsid()
    Setsid = 112,
    /// setreuid(ruid, euid)
    Setreuid = 113,
    /// setregid(rgid, egid)
    Setregid = 114,
    /// getgroups(gidsize, grouplist)
    Getgroups = 115,
    /// setgroups(gidsize, grouplist)
    Setgroups = 116,
    /// setresuid(ruid, euid, suid)
    Setresuid = 117,
    /// getresuid(ruid, euid, suid)
    Getresuid = 118,
    /// setresgid(rgid, egid, sgid)
    Setresgid = 119,
    /// getresgid(rgid, egid, sgid)
    Getresgid = 120,
    /// getpgid(pid)
    Getpgid = 121,
    /// setfsuid(uid)
    Setfsuid = 122,
    /// setfsgid(gid)
    Setfsgid = 123,
    /// getsid(pid)
    Getsid = 124,
    /// capget(cap_header, cap_data)
    Capget = 125,
    /// capset(cap_header, cap_data)
    Capset = 126,
    /// rt_sigpending(set, sigsetsize)
    RtSigpending = 127,
    /// rt_sigtimedwait(how, siginfo, timeout, sigsetsize)
    RtSigtimedwait = 128,
    /// rt_sigqueueinfo(pid, sig, info)
    RtSigqueueinfo = 129,
    /// rt_sigsuspend(sigmask)
    RtSigsuspend = 130,
    /// sigaltstack(ss, oldss)
    Sigaltstack2 = 131,
    /// utime(filename, times)
    Utime = 132,
    /// mknod(path, mode, dev)
    Mknod = 133,
    /// uselib(library)
    Uselib = 134,
    /// personality(persona)
    Personality = 135,
    /// ustat(dev, ubuf)
    Ustat = 136,
    /// statfs(path, buf)
    Statfs = 137,
    /// fstatfs(fd, buf)
    Fstatfs = 138,
    /// sysfs(option, arg1, arg2)
    Sysfs = 139,
    /// getpriority(which, who)
    Getpriority = 140,
    /// setpriority(which, who, prio)
    Setpriority = 141,
    /// sched_setparam(pid, param)
    SchedSetparam = 142,
    /// sched_getparam(pid, param)
    SchedGetparam = 143,
    /// sched_setscheduler(pid, policy, param)
    SchedSetscheduler = 144,
    /// sched_getscheduler(pid)
    SchedGetscheduler = 145,
    /// sched_get_priority_max(policy)
    SchedGetPriorityMax = 146,
    /// sched_get_priority_min(policy)
    SchedGetPriorityMin = 147,
    /// sched_rr_get_interval(pid, interval)
    SchedRrGetInterval = 148,
    /// mlock(addr, len)
    Mlock = 149,
    /// munlock(addr, len)
    Munlock = 150,
    /// mlockall(flags)
    Mlockall = 151,
    /// munlockall()
    Munlockall = 152,
    /// vhangup()
    Vhangup = 153,
    /// modify_ldt(func, ptr, bytecount)
    ModifyLdt = 154,
    /// pivot_root(new_root, put_old)
    PivotRoot = 155,
    /// prctl(option, arg2, arg3, arg4, arg5)
    Prctl = 156,
    /// arch_prctl(addr, data)
    ArchPrctl = 157,
    /// adjtimex(timex)
    Adjtimex = 158,
    /// setrlimit(resource, rlim)
    Setrlimit = 159,
    /// chroot(path)
    Chroot = 160,
    /// sync()
    Sync = 161,
    /// mount(source, target, filesystemtype, mountflags, data)
    Mount = 162,
    /// ustat(dev, ubuf)
    Ustat2 = 163,
    /// swapon(path, swap_flags)
    Swapon = 166,
    /// swapoff(path)
    Swapoff = 167,
    /// reboot(magic1, magic2, cmd, arg)
    Reboot = 168,
    /// sethostname(name, len)
    Sethostname = 170,
    /// setdomainname(name, len)
    Setdomainname = 171,
    /// iopl(level)
    Iopl = 172,
    /// ioperm(from, num, turn_on)
    Ioperm = 173,
    /// init_module(module, len)
    InitModule = 175,
    /// delete_module(name, flags)
    DeleteModule = 176,
    /// quotactl(cmd, special, id, addr)
    Quotactl = 179,
    /// gettid()
    Gettid = 186,
    /// readahead(fd, offset, count)
    Readahead = 187,
    /// setxattr(path, name, value, size, flags)
    Setxattr = 188,
    /// lsetxattr(path, name, value, size, flags)
    Lsetxattr = 189,
    /// fsetxattr(fd, name, value, size, flags)
    Fsetxattr = 190,
    /// getxattr(path, name, value, size)
    Getxattr = 191,
    /// lgetxattr(path, name, value, size)
    Lgetxattr = 192,
    /// fgetxattr(fd, name, value, size)
    Fgetxattr = 193,
    /// listxattr(path, list, size)
    Listxattr = 194,
    /// llistxattr(path, list, size)
    Llistxattr = 195,
    /// flistxattr(fd, list, size)
    Flistxattr = 196,
    /// removexattr(path, name)
    Removexattr = 197,
    /// lremovexattr(path, name)
    Lremovexattr = 198,
    /// fremovexattr(fd, name)
    Fremovexattr = 199,
    /// tkill(tid, sig)
    Tkill = 200,
    /// time(tloc)
    Time = 201,
    /// futex(uaddr, op, val, timeout, uaddr2, val3)
    Futex = 202,
    /// sched_setaffinity(pid, cpusetsize, mask)
    SchedSetaffinity = 203,
    /// sched_getaffinity(pid, cpusetsize, mask)
    SchedGetaffinity = 204,
    /// io_setup(nr_events, ctxp)
    IoSetup = 206,
    /// io_destroy(ctx)
    IoDestroy = 207,
    /// io_getevents(ctx, min_nr, nr, events, timeout)
    IoGetevents = 208,
    /// io_submit(ctx, nr, iocbs)
    IoSubmit = 209,
    /// io_cancel(ctx, iocb, result)
    IoCancel = 210,
    /// lookup_dcookie(dcookie, buf, len)
    LookupDcookie = 212,
    /// epoll_create(size)
    EpollCreate = 213,
    /// remap_file_pages(start, size, prot, pgoff, flags)
    RemapFilePages = 216,
    /// set_tid_address(tidptr)
    SetTidAddress = 218,
    /// timer_create(clockid, sevp, timerid)
    TimerCreate = 222,
    /// timer_settime(timerid, flags, new_value, old_value)
    TimerSettime = 223,
    /// timer_gettime(timerid, cur_value)
    TimerGettime = 224,
    /// timer_getoverrun(timerid)
    TimerGetoverrun = 225,
    /// timer_delete(timerid)
    TimerDelete = 226,
    /// clock_settime(clockid, tp)
    ClockSettime = 227,
    /// clock_gettime(clockid, tp)
    ClockGettime = 228,
    /// clock_getres(clockid, tp)
    ClockGetres = 229,
    /// clock_nanosleep(clockid, flags, request, remain)
    ClockNanosleep = 230,
    /// exit_group(status)
    ExitGroup = 231,
    /// epoll_wait(epfd, events, maxevents, timeout)
    EpollWait = 232,
    /// epoll_ctl(epfd, op, fd, event)
    EpollCtl = 233,
    /// tgkill(tgid, tid, sig)
    Tgkill = 234,
    /// utimes(path, times)
    Utimes = 235,
    /// mbind(start, len, mode, nodes, maxnode, flags)
    Mbind = 237,
    /// set_mempolicy(mode, nodes, maxnode)
    SetMempolicy = 238,
    /// get_mempolicy(mode, nodes, maxnode, addr, flags)
    GetMempolicy = 239,
    /// mq_open(name, oflag, mode, attr)
    MqOpen = 240,
    /// mq_unlink(name)
    MqUnlink = 241,
    /// mq_timedsend(mqdes, msg_ptr, msg_len, msg_prio, timeout)
    MqTimedsend = 242,
    /// mq_timedreceive(mqdes, msg_ptr, msg_len, msg_prio, timeout)
    MqTimedreceive = 243,
    /// mq_notify(mqdes, notification)
    MqNotify = 244,
    /// mq_getsetattr(mqdes, attr, oattr)
    MqGetsetattr = 245,
    /// waitid(idtype, id, info, options)
    Waitid = 247,
    /// set_robust_list(head, len)
    SetRobustList = 274,
    /// get_robust_list(pid, head, len)
    GetRobustList = 275,
    /// prlimit64(pid, resource, new_limit, old_limit)
    Prlimit64 = 302,
    /// name_to_handle_at(dfd, name, handle, mount_id, flags)
    NameToHandleAt = 303,
    /// open_by_handle_at(mount_fd, handle, flags)
    OpenByHandleAt = 304,
    /// clock_adjtime(clockid, timex)
    ClockAdjtime = 305,
    /// syncfs(fd)
    Syncfs = 306,
    /// sendmmsg(sockfd, msg, flags)
    Sendmmsg = 307,
    /// setns(fd, nstype)
    Setns = 308,
    /// getcpu(cpu, node, cache)
    Getcpu = 309,
    /// openat(dirfd, path, flags, mode)
    Openat = 257,
    /// unknown
    Unknown = -1,
}

impl Syscall {
    /// Get from number
    pub fn from_number(n: u32) -> Self {
        match n {
            0 => Self::Read,
            1 => Self::Write,
            2 => Self::Open,
            3 => Self::Close,
            4 => Self::Stat,
            5 => Self::Fstat,
            6 => Self::Lstat,
            7 => Self::Poll,
            8 => Self::Lseek,
            9 => Self::Mmap,
            10 => Self::Mprotect,
            11 => Self::Munmap,
            12 => Self::Brk,
            59 => Self::Execve,
            60 => Self::Exit,
            231 => Self::ExitGroup,
            257 => Self::Openat,
            _ => Self::Unknown,
        }
    }
}

/// Linux open flags
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenFlags {
    ReadOnly = 0x0,
    WriteOnly = 0x1,
    ReadWrite = 0x2,
    Append = 0x200,
    Create = 0x40,
    Exclusive = 0x80,
    Truncate = 0x400,
    NonBlock = 0x800,
}

/// VFS file handle for syscalls
#[derive(Debug, Clone)]
pub struct FileHandle {
    /// File descriptor number
    pub fd: i32,
    /// Path in VFS
    pub path: String,
    /// Flags
    pub flags: OpenFlags,
    /// Current position
    pub position: u64,
    /// Is directory
    pub is_directory: bool,
}

/// Syscall handler context
pub struct SyscallContext {
    /// Open file descriptors
    pub files: HashMap<i32, FileHandle>,
    /// Next file descriptor
    pub next_fd: i32,
    /// Current working directory
    pub cwd: String,
    /// Environment variables
    pub env: HashMap<String, String>,
    /// PID
    pub pid: u32,
    /// UID
    pub uid: u32,
    /// GID
    pub gid: u32,
}

impl Default for SyscallContext {
    fn default() -> Self {
        Self {
            files: HashMap::new(),
            next_fd: 3, // 0,1,2 reserved for stdin/stdout/stderr
            cwd: "/".to_string(),
            env: {
                let mut env = HashMap::new();
                env.insert(
                    "PATH".to_string(),
                    "/usr/local/bin:/usr/bin:/bin".to_string(),
                );
                env.insert("HOME".to_string(), "/home/user".to_string());
                env.insert("TERM".to_string(), "xterm-256color".to_string());
                env
            },
            pid: 1,
            uid: 0,
            gid: 0,
        }
    }
}

impl SyscallContext {
    /// Create standard file descriptors (stdin, stdout, stderr)
    pub fn init_stdio(&mut self) {
        self.files.insert(
            0,
            FileHandle {
                fd: 0,
                path: "/dev/stdin".to_string(),
                flags: OpenFlags::ReadOnly,
                position: 0,
                is_directory: false,
            },
        );
        self.files.insert(
            1,
            FileHandle {
                fd: 1,
                path: "/dev/stdout".to_string(),
                flags: OpenFlags::WriteOnly,
                position: 0,
                is_directory: false,
            },
        );
        self.files.insert(
            2,
            FileHandle {
                fd: 2,
                path: "/dev/stderr".to_string(),
                flags: OpenFlags::WriteOnly,
                position: 0,
                is_directory: false,
            },
        );
        self.next_fd = 3;
    }
}

/// Syscall handler trait for TVM
pub trait SyscallHandler: Send + Sync {
    /// Handle a syscall
    fn handle(&mut self, syscall: Syscall, args: &[u32], vm: &mut TVM) -> i32;
}

/// Default syscall handler implementation
pub struct DefaultSyscallHandler {
    pub context: SyscallContext,
}

impl DefaultSyscallHandler {
    pub fn new() -> Self {
        let mut ctx = SyscallContext::default();
        ctx.init_stdio();
        Self { context: ctx }
    }
}

impl SyscallHandler for DefaultSyscallHandler {
    fn handle(&mut self, syscall: Syscall, args: &[u32], vm: &mut TVM) -> i32 {
        match syscall {
            // Basic I/O
            Syscall::Read => self.sys_read(args, vm),
            Syscall::Write => self.sys_write(args, vm),
            Syscall::Open => self.sys_open(args),
            Syscall::Close => self.sys_close(args),
            Syscall::Lseek => self.sys_lseek(args),
            Syscall::Stat => self.sys_stat(args),
            Syscall::Fstat => self.sys_fstat(args),

            // Memory
            Syscall::Brk => self.sys_brk(args),
            Syscall::Mmap => self.sys_mmap(args),
            Syscall::Mprotect => self.sys_mprotect(args),
            Syscall::Munmap => self.sys_munmap(args),

            // Process
            Syscall::Getpid => self.context.pid as i32,
            Syscall::Getppid => 1,
            Syscall::Getuid => self.context.uid as i32,
            Syscall::Getgid => self.context.gid as i32,
            Syscall::Geteuid => self.context.uid as i32,
            Syscall::Getegid => self.context.gid as i32,
            Syscall::Exit => self.sys_exit(args),
            Syscall::ExitGroup => self.sys_exit(args),
            Syscall::Fork => self.sys_fork(),
            Syscall::Execve => self.sys_execve(args),
            Syscall::Wait4 => self.sys_wait4(args),
            Syscall::Kill => self.sys_kill(args),

            // Directory
            Syscall::Getcwd => self.sys_getcwd(args, vm),
            Syscall::Chdir => self.sys_chdir(args),
            Syscall::Openat => self.sys_openat(args),
            Syscall::Mkdir => self.sys_mkdirat(args),
            Syscall::Getdents => self.sys_getdents64(args),
            Syscall::Unlink => self.sys_unlinkat(args),
            Syscall::Fstat => self.sys_fstatat(args),
            Syscall::Readlink => self.sys_readlinkat(args),

            // Time
            Syscall::Uname => self.sys_uname(vm),
            Syscall::Gettimeofday => self.sys_gettimeofday(args),
            Syscall::Time => self.sys_time(args),
            Syscall::ClockGettime => self.sys_clock_gettime(args),

            // Signal (stub)
            Syscall::RtSigaction => 0,
            Syscall::RtSigprocmask => 0,
            Syscall::Sigaltstack => 0,

            // I/O
            Syscall::Writev => self.sys_writev(args, vm),
            Syscall::Ioctl => self.sys_ioctl(args),

            // Socket (stub - no network)
            Syscall::Socket => -1,
            Syscall::Connect => -1,
            Syscall::Accept => -1,
            Syscall::Listen => -1,
            Syscall::Bind => -1,

            // Other
            Syscall::Access => self.sys_access(args),
            Syscall::Getrlimit => self.sys_getrlimit(args),
            Syscall::Getrusage => self.sys_getrusage(args),

            _ => {
                log::debug!("TVM: Unimplemented syscall {:?}", syscall);
                -1
            }
        }
    }
}

impl DefaultSyscallHandler {
    fn sys_read(&mut self, args: &[u32], vm: &mut TVM) -> i32 {
        let fd = args[0] as i32;
        let buf_ptr = args[1] as usize;
        let count = args[2] as usize;

        if fd == 0 {
            // stdin - for now return 0 (no input)
            return 0;
        }

        // For other files, read from VFS (simplified)
        log::debug!("TVM: read(fd={}, count={})", fd, count);
        0
    }

    fn sys_write(&mut self, args: &[u32], vm: &mut TVM) -> i32 {
        let fd = args[0] as i32;
        let buf_ptr = args[1] as usize;
        let count = args[2] as usize;

        // Read from VM memory
        let data = {
            let mem = vm.memory();
            mem.read(buf_ptr, count)
        };

        if let Some(data) = data {
            let s = String::from_utf8_lossy(data);
            let output = s.to_string(); // Clone to owned string

            match fd {
                1 => {
                    vm.write_stdout(&output);
                    log::debug!("TVM stdout: {}", output);
                }
                2 => {
                    vm.write_stderr(&output);
                    log::debug!("TVM stderr: {}", output);
                }
                _ => {
                    log::debug!("TVM: write to fd {}", fd);
                }
            }
            count as i32
        } else {
            -1
        }
    }

    fn sys_open(&mut self, args: &[u32]) -> i32 {
        // Get path from args - simplified
        let path_ptr = args[0] as usize;
        let _flags = args[1] as i32;
        let _mode = args[2] as i32;

        log::debug!("TVM: open(path_ptr={})", path_ptr);

        // Simplified - always fail for now
        -1
    }

    fn sys_close(&mut self, args: &[u32]) -> i32 {
        let fd = args[0] as i32;

        if fd >= 3 {
            self.context.files.remove(&fd);
        }

        0
    }

    fn sys_brk(&mut self, args: &[u32]) -> i32 {
        // brk(0) returns current break, brk(addr) sets new break
        let addr = args[0] as usize;

        if addr == 0 {
            // Return current break
            super::memory::DEFAULT_MEMORY_LIMIT as i32
        } else {
            // Simplified - just return address
            addr as i32
        }
    }

    fn sys_exit(&mut self, args: &[u32]) -> i32 {
        let status = args[0] as i32;
        log::info!("TVM: exit({})", status);
        status
    }

    fn sys_getcwd(&mut self, args: &[u32], vm: &mut TVM) -> i32 {
        let buf = args[0] as usize;
        let size = args[1] as usize;

        let cwd = &self.context.cwd;
        let bytes = cwd.as_bytes();

        if bytes.len() < size {
            if buf > 0 {
                let _ = vm.memory().write(buf, bytes);
                let _ = vm.memory().write(buf + bytes.len(), &[0]);
            }
            cwd.len() as i32 + 1
        } else {
            -1
        }
    }

    fn sys_uname(&mut self, vm: &mut TVM) -> i32 {
        // Simplified uname - write to a buffer
        log::debug!("TVM: uname()");
        0
    }

    fn sys_writev(&mut self, args: &[u32], vm: &mut TVM) -> i32 {
        let fd = args[0] as i32;
        let iov_ptr = args[1] as usize;
        let iovcnt = args[2] as usize;

        log::debug!("TVM: writev(fd={}, iovcnt={})", fd, iovcnt);

        // Simplified - just return count
        iovcnt as i32
    }

    fn sys_lseek(&mut self, args: &[u32]) -> i32 {
        let _fd = args[0] as i32;
        let _offset = args[1] as i32;
        let _whence = args[2] as i32;
        log::debug!("TVM: lseek()");
        0
    }

    fn sys_stat(&mut self, args: &[u32]) -> i32 {
        let _path_ptr = args[0] as usize;
        let _statbuf = args[1] as usize;
        log::debug!("TVM: stat()");
        -1
    }

    fn sys_fstat(&mut self, args: &[u32]) -> i32 {
        let _fd = args[0] as i32;
        let _statbuf = args[1] as usize;
        log::debug!("TVM: fstat()");
        -1
    }

    fn sys_mmap(&mut self, args: &[u32]) -> i32 {
        let _addr = args[0] as usize;
        let _len = args[1] as usize;
        let _prot = args[2] as i32;
        let _flags = args[3] as i32;
        let _fd = args[4] as i32;
        let _offset = args[5] as u64;
        log::debug!("TVM: mmap()");
        -1
    }

    fn sys_mprotect(&mut self, args: &[u32]) -> i32 {
        let _addr = args[0] as usize;
        let _len = args[1] as usize;
        let _prot = args[2] as i32;
        log::debug!("TVM: mprotect()");
        0
    }

    fn sys_munmap(&mut self, args: &[u32]) -> i32 {
        let _addr = args[0] as usize;
        let _len = args[1] as usize;
        log::debug!("TVM: munmap()");
        0
    }

    fn sys_fork(&mut self) -> i32 {
        log::debug!("TVM: fork()");
        -1
    }

    fn sys_execve(&mut self, args: &[u32]) -> i32 {
        let _path = args[0] as usize;
        let _argv = args[1] as usize;
        let _envp = args[2] as usize;
        log::debug!("TVM: execve()");
        -1
    }

    fn sys_wait4(&mut self, args: &[u32]) -> i32 {
        let _pid = args[0] as i32;
        let _status = args[1] as usize;
        let _options = args[2] as i32;
        let _rusage = args[3] as usize;
        log::debug!("TVM: wait4()");
        -1
    }

    fn sys_kill(&mut self, args: &[u32]) -> i32 {
        let _pid = args[0] as i32;
        let _sig = args[1] as i32;
        log::debug!("TVM: kill()");
        -1
    }

    fn sys_chdir(&mut self, args: &[u32]) -> i32 {
        let _path = args[0] as usize;
        log::debug!("TVM: chdir()");
        0
    }

    fn sys_openat(&mut self, args: &[u32]) -> i32 {
        let _dirfd = args[0] as i32;
        let _path = args[1] as usize;
        let _flags = args[2] as i32;
        let _mode = args[3] as i32;
        log::debug!("TVM: openat()");
        -1
    }

    fn sys_mkdirat(&mut self, args: &[u32]) -> i32 {
        let _dirfd = args[0] as i32;
        let _path = args[1] as usize;
        let _mode = args[2] as i32;
        log::debug!("TVM: mkdirat()");
        -1
    }

    fn sys_getdents64(&mut self, args: &[u32]) -> i32 {
        let _fd = args[0] as i32;
        let _buf = args[1] as usize;
        let _count = args[2] as usize;
        log::debug!("TVM: getdents64()");
        0
    }

    fn sys_unlinkat(&mut self, args: &[u32]) -> i32 {
        let _dirfd = args[0] as i32;
        let _path = args[1] as usize;
        let _flags = args[2] as i32;
        log::debug!("TVM: unlinkat()");
        -1
    }

    fn sys_fstatat(&mut self, args: &[u32]) -> i32 {
        let _dirfd = args[0] as i32;
        let _path = args[1] as usize;
        let _buf = args[2] as usize;
        let _flags = args[3] as i32;
        log::debug!("TVM: fstatat()");
        -1
    }

    fn sys_readlinkat(&mut self, args: &[u32]) -> i32 {
        let _dirfd = args[0] as i32;
        let _path = args[1] as usize;
        let _buf = args[2] as usize;
        let _bufsiz = args[3] as usize;
        log::debug!("TVM: readlinkat()");
        -1
    }

    fn sys_gettimeofday(&mut self, args: &[u32]) -> i32 {
        let _tv = args[0] as usize;
        let _tz = args[1] as usize;
        log::debug!("TVM: gettimeofday()");
        0
    }

    fn sys_time(&mut self, args: &[u32]) -> i32 {
        let _tloc = args[0] as usize;
        log::debug!("TVM: time()");
        0
    }

    fn sys_clock_gettime(&mut self, args: &[u32]) -> i32 {
        let _clock_id = args[0] as i32;
        let _tp = args[1] as usize;
        log::debug!("TVM: clock_gettime()");
        0
    }

    fn sys_ioctl(&mut self, args: &[u32]) -> i32 {
        let _fd = args[0] as i32;
        let _request = args[1] as u32;
        let _arg = args[2] as usize;
        log::debug!("TVM: ioctl()");
        -1
    }

    fn sys_access(&mut self, args: &[u32]) -> i32 {
        let _path = args[0] as usize;
        let _mode = args[1] as i32;
        log::debug!("TVM: access()");
        -1
    }

    fn sys_getrlimit(&mut self, args: &[u32]) -> i32 {
        let _resource = args[0] as i32;
        let _rlim = args[1] as usize;
        log::debug!("TVM: getrlimit()");
        0
    }

    fn sys_getrusage(&mut self, args: &[u32]) -> i32 {
        let _who = args[0] as i32;
        let _usage = args[1] as usize;
        log::debug!("TVM: getrusage()");
        0
    }
}

/// Create syscall handler closure for TVM
pub fn create_syscall_handler() -> impl FnMut(u32, &mut TVM) -> i32 + Send + Sync {
    let mut handler = DefaultSyscallHandler::new();
    move |num: u32, vm: &mut TVM| {
        let syscall = Syscall::from_number(num);
        let args = [
            vm.registers().get(1),
            vm.registers().get(2),
            vm.registers().get(3),
            vm.registers().get(4),
            vm.registers().get(5),
            vm.registers().get(6),
        ];
        handler.handle(syscall, &args, vm)
    }
}
