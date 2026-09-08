import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { JetButton } from '../components/JetControls';
import { FinanceStoryRail } from '../components/FinanceStory';
import { CUSTOMER_NAME } from '../config/customer';

const USE_CASES = [
  {
    label: 'Risk & Operations Dashboard',
    intro: 'Starts the fraud-led operating picture for:',
    bullets: [
      'Financial crime exposure and operational KPIs',
      'Client transaction and case visibility',
      'Compliance signal impact on products and regions',
      'Executive-ready risk and revenue context',
    ],
    outro: 'Use it to open the response story: one high-risk payment pattern is moving through the bank.',
    tone: '#C74634',
  },
  {
    label: 'Risk Signal Intelligence',
    intro: 'Triage regulatory, fraud, AML, and market activity to:',
    bullets: [
      'Identify emerging financial-crime indicators',
      'Detect transaction volume and exposure shifts',
      'Prioritize compliance alerts by severity',
      'Surface affected products, policies, and client workflows',
    ],
    tone: '#4F7D7B',
  },
  {
    label: 'Financial Crime Network',
    intro: 'Demonstrates graph analytics for:',
    bullets: [
      'Account, device, IP, payee, and merchant relationships',
      'Fraud-ring and shared-infrastructure detection',
      'Case propagation and connected exposure analysis',
      'Investigator-ready network exploration',
    ],
    tone: '#796087',
  },
  {
    label: 'Client Service & SLA Coverage',
    intro: 'Shows whether operations can absorb the case load across:',
    bullets: [
      'Branch and service-center coverage',
      'Regional SLA visibility',
      'Case distribution and processing capacity',
      'Advisor, branch, and operations network decisions',
    ],
    tone: '#5F7D4F',
  },
  {
    label: 'Transaction & Case Operations',
    intro: 'Connects client transactions to governed case workflows for:',
    bullets: [
      'Signal-linked transaction review',
      'Audit-ready investigation workflows',
      'Partner and channel integrations',
      'Modern API-driven finance applications',
    ],
    tone: '#A36472',
  },
  {
    label: 'Predictive Risk, Capacity & Revenue',
    intro: 'Forecasts the downstream impact of fraud and compliance pressure on:',
    bullets: [
      'Operational risk and service-pressure forecasting',
      'Client value and attrition segments',
      'Financial product risk cohorts',
      'Predictive service-capacity recommendations',
    ],
    tone: '#4C825C',
  },
  {
    label: 'Governed Data Copilot',
    intro: 'Lets sellers and analysts ask scenario questions to:',
    bullets: [
      'Explain the fraud-led storyline in plain English',
      'Query live governed finance data',
      'Inspect evidence behind operational decisions',
    ],
    tone: '#697778',
  },
  {
    label: 'AI Operations Agent Console',
    intro: 'Shows governed AI agents coordinating:',
    bullets: [
      'Fraud, risk, and service recommendations',
      'Cross-team operational actions',
      'Human-reviewable decisions',
      'Durable audit records for every recommendation',
    ],
    tone: '#6B7494',
  },
];

const USE_CASES_PER_PAGE = 3;

export default function Welcome({ onNavigate }) {
  const [useCasePage, setUseCasePage] = useState(0);
  const pageCount = Math.ceil(USE_CASES.length / USE_CASES_PER_PAGE);
  const carouselStart = useCasePage * USE_CASES_PER_PAGE;
  const visibleUseCases = USE_CASES.slice(carouselStart, carouselStart + USE_CASES_PER_PAGE);
  const carouselEnd = Math.min(carouselStart + visibleUseCases.length, USE_CASES.length);
  const canGoPrevious = useCasePage > 0;
  const canGoNext = useCasePage < pageCount - 1;

  const goToPreviousUseCases = () => {
    setUseCasePage((page) => Math.max(0, page - 1));
  };

  const goToNextUseCases = () => {
    setUseCasePage((page) => Math.min(pageCount - 1, page + 1));
  };

  return (
    <div className="space-y-6 fade-in max-w-[1700px] mx-auto">
      <section className="glass-card p-7">
        <div className="space-y-4">
          <h1 className="text-4xl font-semibold tracking-tight leading-tight">
            {CUSTOMER_NAME} financial crime and operations intelligence on one governed Oracle data platform.
          </h1>
          <div className="w-full space-y-4 text-base text-[var(--color-text-dim)] leading-7">
            <p>
              {CUSTOMER_NAME} shows how a financial institution responds when an AML and payments-risk signal exposes suspicious transaction activity. Business users move from signal triage to product exposure, connected-entity investigation, service capacity, predictive impact, and governed AI action without leaving the trusted operational data foundation.
            </p>
            <p>
              Follow a finance operations journey across Seer Bank: compliance teams identify the risk pattern, investigators trace accounts and payees, operations managers protect SLA capacity, and AI agents recommend auditable next actions while Oracle AI Database 26ai keeps the evidence, access controls, and decision history governed.
            </p>
          </div>
          <FinanceStoryRail />
          <div className="flex flex-wrap gap-3 pt-1">
            <JetButton
              label="Start the demo"
              iconClass="oj-fwk-icon oj-fwk-icon-folderhierarchy"
              chroming="callToAction"
              className="welcome-jet-button welcome-start-demo-button"
              onAction={() => onNavigate('datamodel')}
            />
          </div>
        </div>
      </section>

      <section className="glass-card p-7">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-2xl font-semibold">Key Finance Use Cases Featured</h2>
          <div className="flex items-center gap-2" aria-label="Use case carousel controls">
            <button
              type="button"
              aria-label="Show previous use cases"
              onClick={goToPreviousUseCases}
              disabled={!canGoPrevious}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                borderColor: 'var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
              }}
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Show next use cases"
              onClick={goToNextUseCases}
              disabled={!canGoNext}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                borderColor: 'var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
              }}
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[var(--color-text-dim)]">
            Showing {carouselStart + 1}-{carouselEnd} of {USE_CASES.length}
          </p>
          <div className="flex items-center gap-1.5" aria-label="Use case groups">
            {Array.from({ length: pageCount }).map((_, index) => (
              <button
                key={index}
                type="button"
                aria-label={`Show use case group ${index + 1}`}
                aria-current={useCasePage === index ? 'true' : undefined}
                onClick={() => setUseCasePage(index)}
                className="h-2.5 rounded-full transition-all"
                style={{
                  width: useCasePage === index ? '22px' : '10px',
                  background: useCasePage === index ? '#AA643B' : 'var(--color-border)',
                }}
              />
            ))}
          </div>
        </div>
        <div
          className="grid gap-3 mt-4 lg:grid-cols-3"
          aria-live="polite"
          aria-label={`Use cases ${carouselStart + 1} through ${carouselEnd}`}
        >
          {visibleUseCases.map((useCase) => (
            <div
              key={useCase.label}
              className="border p-3.5 flex flex-col gap-2.5"
              style={{
                borderColor: 'var(--color-border)',
                borderRadius: '6px',
                background: 'var(--color-surface-muted)',
                borderTopWidth: '3px',
                borderTopColor: useCase.tone,
              }}
            >
              <div className="text-[15px] font-semibold leading-snug">{useCase.label}</div>
              <p className="text-sm text-[var(--color-text-dim)] leading-5">{useCase.intro}</p>
              <ul className="list-disc pl-4 space-y-1 text-sm text-[var(--color-text-dim)] leading-5">
                {useCase.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
              {useCase.outro ? (
                <p className="text-sm text-[var(--color-text-dim)] leading-5">{useCase.outro}</p>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
