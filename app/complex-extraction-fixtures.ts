import type { ExtractionFixture } from "./extraction-regression";

// Challenging fictional notes. Keep these separate from the original baseline.
export const COMPLEX_EXTRACTION_FIXTURES: ExtractionFixture[] = [
  {
    id: "complex_corrections", title: "Corrected date and remote job location",
    note: "Michael said he's moving to Seattle in December. Actually, he meant January. His wife found a job in Portland, but she'll be working remotely, so they're still moving to Seattle.", date: "2026-11-08",
    expected: [
      { label: "Michael moves to Seattle in January", person: "Michael", signals: ["mov", "Seattle", "January"], factType: "timeline" },
      { label: "Michael's wife has remote Portland job", person: "Michael", signals: ["wife", "job", "Portland", "remot"], factType: "timeline" },
    ],
    forbidden: [
      { label: "December treated as current moving date", signals: ["Seattle\\s+(?:in|for)\\s+December"] },
      { label: "Michael moving to Portland", signals: ["(?:Michael|he).*mov(?:ing|es|e).*Portland"] },
      { label: "Invented wife contact", person: "Michael's wife", signals: ["job"] },
    ],
  },
  {
    id: "complex_relatives", title: "Nested relatives and pronoun continuity",
    note: "Kyle's older brother Francis recently got married. His wife is a teacher. Kyle's younger sister Emily attended the wedding, but she couldn't stay long because her daughter was sick.", date: "2026-11-08",
    expected: [
      { label: "Francis is Kyle's older brother", person: "Kyle", signals: ["Francis", "older", "brother"], factType: "profile" },
      { label: "Francis recently married", person: "Kyle", signals: ["Francis", "marri"], factType: "timeline" },
      { label: "Francis's wife teaches", person: "Kyle", signals: ["Francis", "wife", "teach"], factType: "profile" },
      { label: "Emily is Kyle's younger sister", person: "Kyle", signals: ["Emily", "younger", "sister"], factType: "profile" },
      { label: "Emily left wedding early because daughter sick", person: "Kyle", signals: ["Emily", "wedding", "daughter", "sick"], factType: "timeline" },
    ],
  },
  {
    id: "complex_ideation", title: "Evolving restaurant idea without false certainty",
    note: "Jason was thinking about opening a restaurant. He initially wanted to do Japanese food, but lately he's been leaning toward Korean barbecue. He hasn't decided whether to actually pursue it.", date: "2026-11-08",
    expected: [
      { label: "Jason considering restaurant", person: "Jason", signals: ["restaurant", "(?:think|consider|might|idea|plan|possible)"], factType: "timeline" },
      { label: "Jason's tentative concept shifted", person: "Jason", signals: ["Japanese", "Korean", "(?:lean|prefer|shift|change|instead|toward)"], factType: "timeline" },
    ],
    forbidden: [
      { label: "Restaurant already open", person: "Jason", signals: ["(?:opened|founded|started) (?:a |his )?restaurant"] },
      { label: "Restaurant decision final", person: "Jason", signals: ["(?:definitely|decided to|committed to).*restaurant"] },
    ],
  },
  {
    id: "complex_causal_milestones", title: "Injury, interruption, therapy, and return",
    note: "Sarah injured her ankle while training for a marathon in March. She stopped running for two months, started physical therapy in May, and recently completed her first 5K since recovering.", date: "2026-11-08",
    expected: [
      { label: "Sarah ankle injury in March", person: "Sarah", signals: ["ankle", "injur", "March"], factType: "timeline" },
      { label: "Sarah stopped running two months", person: "Sarah", signals: ["(?:stop|pause|break|off)", "run", "(?:two|2) months"], factType: "timeline" },
      { label: "Sarah started PT in May", person: "Sarah", signals: ["(?:physical therapy|physiotherapy|\\bPT\\b)", "May"], factType: "timeline" },
      { label: "Sarah completed return 5K", person: "Sarah", signals: ["(?:5K|five.kilometer)", "(?:first|return|recover|complete)"], factType: "timeline" },
    ],
  },
  {
    id: "complex_uncertainty", title: "Uncertain layoff versus confirmed teammate layoff",
    note: "Daniel told me he might be getting laid off next month. His manager hasn't confirmed anything. However, his teammate Eric was definitely laid off yesterday. Daniel is already interviewing at Microsoft just in case.", date: "2026-11-08",
    expected: [
      { label: "Daniel potential unconfirmed layoff", person: "Daniel", signals: ["lay|laid", "(?:might|possible|unconfirm|uncertain|rumor|may)"], factType: "timeline" },
      { label: "Teammate Eric was laid off", person: "Daniel", signals: ["Eric", "laid off"], factType: "timeline" },
      { label: "Daniel interviewing at Microsoft", person: "Daniel", signals: ["interview", "Microsoft"], factType: "timeline" },
    ],
    forbidden: [
      { label: "Daniel definitively laid off", person: "Daniel", signals: ["Daniel (?:was|has been|got) laid off"] },
      { label: "Daniel works at Microsoft", person: "Daniel", signals: ["(?:works?|employed|started).*Microsoft"] },
    ],
  },
  {
    id: "complex_incremental", title: "Repeated employer, promotion, tentative transfer",
    note: "Emily has been working at Nvidia for about three years. She's still at Nvidia, actually. She recently became a senior engineer there, and she's thinking about transferring to their Austin office.", date: "2026-11-08",
    expected: [
      { label: "Emily Nvidia three-year tenure", person: "Emily", signals: ["Nvidia", "(?:three|3) years"], factType: "profile" },
      { label: "Emily promoted senior engineer", person: "Emily", signals: ["senior engineer", "(?:promot|became|now|recent|advance)"], factType: "timeline" },
      { label: "Emily considers Austin transfer", person: "Emily", signals: ["Austin", "transfer", "(?:think|consider|might|plan|possible)"], factType: "timeline" },
    ],
  },
  {
    id: "complex_two_gatherings", title: "Two dated notes retain superseded school plan as history",
    // Runner processes each gathering separately and aggregates their outputs.
    note: "Kyle mentioned he might apply to graduate school next year. He's particularly interested in Stanford.", date: "2026-10-08",
    notes: [
      { date: "2026-10-08", note: "Kyle mentioned he might apply to graduate school next year. He's particularly interested in Stanford." },
      { date: "2026-11-08", note: "Kyle decided against Stanford because of the cost. He's now applying to Berkeley instead, and he submitted his application yesterday." },
    ],
    expected: [
      { label: "Kyle considered Stanford", person: "Kyle", signals: ["Stanford", "(?:consider|interest|might|plan|thinking)"], factType: "timeline" },
      { label: "Kyle dropped Stanford due to cost", person: "Kyle", signals: ["Stanford", "(?:cost|expens|price|tuition)", "(?:against|not|drop|decid|reject)"], factType: "timeline" },
      { label: "Kyle submitted Berkeley application", person: "Kyle", signals: ["Berkeley", "(?:submit|sent|applied)", "(?:yesterday|Nov|November|7)"], factType: "timeline" },
    ],
  },
  {
    id: "complex_history", title: "Repeated location across past, present, and future",
    note: "Sarah used to live in Boston. She moved to New York last year, but she's moving back to Boston next month. She originally planned to move in December, although she recently pushed the date to January.", date: "2026-11-08",
    expected: [
      { label: "Sarah previously lived in Boston", person: "Sarah", signals: ["Boston", "(?:used to|previous|formerly|past|before|old)"] , factType: "profile" },
      { label: "Sarah moved New York last year", person: "Sarah", signals: ["New York", "mov", "(?:last year|2025)"], factType: "timeline" },
      { label: "Sarah moving back Boston January", person: "Sarah", signals: ["Boston", "mov", "January"], factType: "timeline" },
    ],
    forbidden: [{ label: "December still current plan", person: "Sarah", signals: ["(?:moving|move) (?:back )?to Boston in December"] }],
  },
];
