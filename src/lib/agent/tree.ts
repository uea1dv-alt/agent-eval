/**
 * 平铺数组 → 树。
 *
 * 为什么要这一步：数据库里 span 是一张**平表**，层级关系靠 `parentId` 自关联表达。
 * 平表好写（插入一条不用管别人）、好查（一条 SQL 拿全部），但界面上要画成
 * 可展开的树，就得先在前端把父子关系重新接起来。
 *
 * 这个转换是纯函数：给定同一批 span，永远得到同一棵树。所以它可以被反复调用 ——
 * SSE 每来一个新 span，我们就重建一次树，树就「边跑边长」了。
 */

export interface TreeNode<T> {
  node: T
  children: TreeNode<T>[]
}

/** 树节点至少要有这三个字段：靠 id 认自己，靠 parentId 认爹，靠 createdAt 排序 */
export interface TreeItem {
  id: string
  parentId: string | null
  createdAt: string
}

export function buildTree<T extends TreeItem>(items: T[]): TreeNode<T>[] {
  const nodes = new Map<string, TreeNode<T>>()
  for (const item of items) {
    nodes.set(item.id, { node: item, children: [] })
  }

  const roots: TreeNode<T>[] = []

  for (const item of items) {
    const node = nodes.get(item.id)!
    const parent = item.parentId ? nodes.get(item.parentId) : undefined

    if (parent) {
      parent.children.push(node)
    } else {
      // 父节点不在这一批数据里（被分页截断了，或者父记录已被删）。
      // 这种情况**必须当根节点处理** —— 否则这些 span 在界面上会凭空消失，
      // 而且消失得毫无痕迹，比显示错位置更难查。
      roots.push(node)
    }
  }

  const byTime = (a: TreeNode<T>, b: TreeNode<T>) =>
    a.node.createdAt.localeCompare(b.node.createdAt) ||
    a.node.id.localeCompare(b.node.id)

  const sortRecursive = (list: TreeNode<T>[]) => {
    list.sort(byTime)
    for (const child of list) sortRecursive(child.children)
  }
  sortRecursive(roots)

  return roots
}

/** 整棵树的节点总数。用来在界面上显示「这次运行产生了 N 个 span」 */
export function countNodes<T>(roots: TreeNode<T>[]): number {
  return roots.reduce((sum, r) => sum + 1 + countNodes(r.children), 0)
}
