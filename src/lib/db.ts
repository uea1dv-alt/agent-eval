import { PrismaClient } from '@prisma/client'

// 为什么需要这个文件而不是直接 new PrismaClient()：
// Next.js 开发模式下每次热重载都会重新执行模块，如果每次都 new 一个 client，
// 连接数会越堆越多，最后报 "too many connections"。
// 把实例挂到 globalThis 上，热重载时复用同一个。
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
