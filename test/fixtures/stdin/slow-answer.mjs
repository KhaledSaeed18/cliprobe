#!/usr/bin/env node
// Never reads stdin, but takes 3.4 s to answer, like a cold JVM tool.
setTimeout(() => console.log('slow 1.0.0'), 3400);
