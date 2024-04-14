//
// Copyright © 2022 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import core, {
  type AnyAttribute,
  type Class,
  type Data,
  type Doc,
  type DocIndexState,
  type FullTextSearchContext,
  generateId,
  getFullTextContext,
  type Hierarchy,
  type IndexStageState,
  type MeasureContext,
  type Obj,
  type Ref,
  type Space,
  TxFactory
} from '@hcengineering/core'
import { deepEqual } from 'fast-equals'
import { type DbAdapter } from '../adapter'
import plugin from '../plugin'
import { type FullTextPipeline } from './types'

export { docKey, docUpdKey, extractDocKey, isFullTextAttribute } from '@hcengineering/core'
export type { IndexKeyOptions } from '@hcengineering/core'

/**
 * @public
 */
export function getContent (
  hierarchy: Hierarchy,
  attributes: AnyAttribute[],
  doc: Doc
): Record<string, { value: any, attr: AnyAttribute }> {
  const attrs: Record<string, { value: any, attr: AnyAttribute }> = {}

  for (const attr of attributes) {
    const isMixinAttr = hierarchy.isMixin(attr.attributeOf)
    if (isMixinAttr) {
      const key = (attr.attributeOf as string) + '.' + attr.name
      const value = (doc as any)[attr.attributeOf]?.[attr.name]?.toString() ?? ''
      attrs[key] = { value, attr }
    } else {
      const value = (doc as any)[attr.name]?.toString() ?? ''
      attrs[attr.name] = { value, attr }
    }
  }
  return attrs
}

/**
 * @public
 */
export function createStateDoc (
  id: Ref<Doc>,
  objectClass: Ref<Class<Obj>>,
  data: Omit<Data<DocIndexState>, 'objectClass'> & { space?: Ref<Space> }
): DocIndexState {
  return {
    _class: core.class.DocIndexState,
    _id: id as Ref<DocIndexState>,
    space: data.space ?? plugin.space.DocIndexState,
    objectClass,
    modifiedBy: core.account.System,
    modifiedOn: Date.now(),
    ...data
  }
}

/**
 * @public
 */
export async function loadIndexStageStage (
  ctx: MeasureContext,
  storage: DbAdapter,
  state: IndexStageState | undefined,
  stageId: string,
  field: string,
  newValue: any
): Promise<[boolean | string, IndexStageState]> {
  if (state === undefined) {
    ;[state] = await storage.findAll(ctx, core.class.IndexStageState, { stageId })
  }
  const attributes: Record<string, any> = state?.attributes ?? {}

  let result: boolean | string | undefined = attributes?.index !== undefined ? `${attributes?.index as number}` : true

  if (!deepEqual(attributes[field], newValue)) {
    // Not match,
    const newIndex = ((attributes.index as number) ?? 0) + 1
    result = `${newIndex}`

    const ops = new TxFactory(core.account.System, true)
    const data = {
      stageId,
      attributes: {
        [field]: newValue,
        index: newIndex
      }
    }
    if (state === undefined) {
      const id: Ref<IndexStageState> = generateId()
      await storage.tx(ctx, ops.createTxCreateDoc(core.class.IndexStageState, plugin.space.DocIndexState, data, id))
      state = {
        ...data,
        _class: core.class.IndexStageState,
        _id: id,
        space: plugin.space.DocIndexState,
        modifiedBy: core.account.System,
        modifiedOn: Date.now()
      }
    } else {
      await storage.tx(
        ctx,
        ops.createTxUpdateDoc(core.class.IndexStageState, plugin.space.DocIndexState, state._id, data)
      )
      state = { ...state, ...data, modifiedOn: Date.now() }
    }
  }
  return [result, state]
}

/**
 * @public
 */
export function traverseFullTextContexts (
  pipeline: FullTextPipeline,
  objectClass: Ref<Class<Doc>>,
  op: (ftc: Omit<FullTextSearchContext, keyof Class<Doc>>) => void
): Ref<Class<Doc>>[] {
  const desc = new Set(pipeline.hierarchy.getDescendants(objectClass))
  const propagate = new Set<Ref<Class<Doc>>>()

  const ftContext = getFullTextContext(pipeline.hierarchy, objectClass)
  if (ftContext !== undefined) {
    op(ftContext)
  }

  // Add all parent mixins as well
  for (const a of pipeline.hierarchy.getAncestors(objectClass)) {
    const ftContext = getFullTextContext(pipeline.hierarchy, a)
    if (ftContext !== undefined) {
      op(ftContext)
    }
    const dsca = pipeline.hierarchy.getDescendants(a)
    for (const dd of dsca) {
      if (pipeline.hierarchy.isMixin(dd)) {
        desc.add(dd)
      }
    }
  }

  for (const d of desc) {
    if (pipeline.hierarchy.isMixin(d)) {
      const mContext = getFullTextContext(pipeline.hierarchy, d)
      if (mContext !== undefined) {
        op(mContext)
      }
    }
  }
  return Array.from(propagate.values())
}

/**
 * @public
 */
export function collectPropagate (pipeline: FullTextPipeline, objectClass: Ref<Class<Doc>>): Ref<Class<Doc>>[] {
  const propagate = new Set<Ref<Class<Doc>>>()
  traverseFullTextContexts(pipeline, objectClass, (fts) => fts?.propagate?.forEach((it) => propagate.add(it)))

  return Array.from(propagate.values())
}

/**
 * @public
 */
export function collectPropagateClasses (pipeline: FullTextPipeline, objectClass: Ref<Class<Doc>>): Ref<Class<Doc>>[] {
  const propagate = new Set<Ref<Class<Doc>>>()
  traverseFullTextContexts(pipeline, objectClass, (fts) => fts?.propagateClasses?.forEach((it) => propagate.add(it)))

  return Array.from(propagate.values())
}

const CUSTOM_ATTR_KEY = 'customAttributes'
const CUSTOM_ATTR_UPDATE_KEY = 'attributes.customAttributes'

/**
 * @public
 */
export function getCustomAttrKeys (): { customAttrKey: string, customAttrUKey: string } {
  return { customAttrKey: CUSTOM_ATTR_KEY, customAttrUKey: CUSTOM_ATTR_UPDATE_KEY }
}

/**
 * @public
 */
export function isCustomAttr (attr: string): boolean {
  return attr === CUSTOM_ATTR_KEY
}
