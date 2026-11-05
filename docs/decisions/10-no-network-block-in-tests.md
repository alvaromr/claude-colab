# 10. No network block in the tests

- **Practice set aside:** a build that blocks the network in tests.
- **Why:** every address they connect to is loopback, and the others they name are documentation ranges, which route
  nowhere, so no test can reach another machine. A block would patch Node's sockets in every process the tests start,
  to guard against what no address of theirs can do.
- **Decided by:** proposed by an agent; awaiting the owner's approval.
