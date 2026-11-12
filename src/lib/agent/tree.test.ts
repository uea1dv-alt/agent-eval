import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildTree, countNodes, type TreeItem } from './tree'

interface Item extends TreeItem {
  name: string
}

function item(id: string, parentId: string | null, createdAt: string): Item {
  return { id, parentId, createdAt, name: id }
}

describe('buildTree', () => {
  it('按 parentId 接回父子关系', () => {
    const tree = buildTree([
      item('root', null, '2026-03-10T00:00:00.000Z'),
      item('step', 'root', '2026-03-10T00:00:01.000Z'),
      item('tool', 'step', '2026-03-10T00:00:02.000Z'),
    ])

    assert.equal(tree.length, 1)
    assert.equal(tree[0].node.id, 'root')
    assert.equal(tree[0].children[0].node.id, 'step')
    assert.equal(tree[0].children[0].children[0].node.id, 'tool')
  })

  it('父节点不在这批数据里时当根节点 —— 不能让它凭空消失', () => {
    // 这正是「按 span 截断分页」会造成的形状：子 span 在，父 span 没查到
    const tree = buildTree([item('orphan', 'missing-parent', '2026-03-10T00:00:00.000Z')])

    assert.equal(tree.length, 1)
    assert.equal(tree[0].node.id, 'orphan')
  })

  it('同级按 createdAt 排序，时间一样再按 id —— 顺序不能随输入数组变', () => {
    const tree = buildTree([
      item('root', null, '2026-03-10T00:00:00.000Z'),
      item('b', 'root', '2026-03-10T00:00:02.000Z'),
      item('a', 'root', '2026-03-10T00:00:01.000Z'),
      item('c', 'root', '2026-03-10T00:00:02.000Z'),
    ])

    assert.deepEqual(
      tree[0].children.map((child) => child.node.id),
      ['a', 'b', 'c'],
    )
  })

  it('countNodes 数整棵树', () => {
    const tree = buildTree([
      item('root', null, '2026-03-10T00:00:00.000Z'),
      item('step', 'root', '2026-03-10T00:00:01.000Z'),
      item('tool', 'step', '2026-03-10T00:00:02.000Z'),
      item('step-2', 'root', '2026-03-10T00:00:03.000Z'),
    ])

    assert.equal(countNodes(tree), 4)
  })
})
