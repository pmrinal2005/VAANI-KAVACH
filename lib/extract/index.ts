import type { Base, Ctx, Field, Issue, WorkflowId } from '../types'
import { extractMoneyOrder, computeMoneyOrder } from './money_order'
import { extractServiceRequest, computeServiceRequest } from './service_request'
import { extractHandover, computeHandover } from './handover'
import { extractRiskReview, computeRiskReview } from './risk_review'

export function extractBase(workflow: WorkflowId, text: string, ctx: Ctx): { base: Base; issues: Issue[] } {
  switch (workflow) {
    case 'money_order': return extractMoneyOrder(text, ctx)
    case 'service_request': return extractServiceRequest(text, ctx)
    case 'handover': return extractHandover(text, ctx)
    case 'risk_review': return extractRiskReview(text, ctx)
  }
}

export function computeFields(workflow: WorkflowId, base: Base, ctx: Ctx, carried: Issue[]): { fields: Record<string, Field>; issues: Issue[] } {
  switch (workflow) {
    case 'money_order': return computeMoneyOrder(base, ctx, carried)
    case 'service_request': return computeServiceRequest(base, ctx, carried)
    case 'handover': return computeHandover(base, ctx, carried)
    case 'risk_review': return computeRiskReview(base, ctx, carried)
  }
}
