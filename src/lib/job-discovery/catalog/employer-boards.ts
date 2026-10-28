export type EmployerBoardSeed = {
  provider: 'greenhouse' | 'lever' | 'ashby';
  token: string;
  employer: string;
  careersUrl: string;
  industry: string;
  country: string;
  region: string;
  descriptionMode: 'full' | 'metadata';
};

/**
 * Employer boards verified against the provider's public posting API and the
 * employer's own careers page. Board tokens are not guessed: each entry in
 * this file returned a live board when checked on 2026-10-28 and is listed in
 * docs/JOB_DISCOVERY.md with its verification date.
 *
 * Large boards use "metadata" mode so one sync does not download tens of
 * megabytes of descriptions; their titles, locations, URLs and dates are still
 * refreshed. This is a cost boundary, not a claim that descriptions are
 * unavailable.
 */
export const EMPLOYER_BOARD_SEEDS: EmployerBoardSeed[] = [
  { provider: 'greenhouse', token: 'anthropic', employer: 'Anthropic', careersUrl: 'https://www.anthropic.com/careers', industry: 'Technology & AI', country: 'US', region: 'North America', descriptionMode: 'metadata' },
  { provider: 'greenhouse', token: 'stripe', employer: 'Stripe', careersUrl: 'https://stripe.com/jobs', industry: 'Financial technology', country: 'US', region: 'Global', descriptionMode: 'metadata' },
  { provider: 'greenhouse', token: 'airbnb', employer: 'Airbnb', careersUrl: 'https://careers.airbnb.com/', industry: 'Hospitality & travel', country: 'US', region: 'Global', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'coinbase', employer: 'Coinbase', careersUrl: 'https://www.coinbase.com/careers', industry: 'Financial services', country: 'US', region: 'Global', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'robinhood', employer: 'Robinhood', careersUrl: 'https://careers.robinhood.com/', industry: 'Financial services', country: 'US', region: 'North America', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'reddit', employer: 'Reddit', careersUrl: 'https://redditinc.com/careers', industry: 'Technology & media', country: 'US', region: 'North America', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'gitlab', employer: 'GitLab', careersUrl: 'https://about.gitlab.com/jobs/', industry: 'Technology & software', country: 'US', region: 'Global', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'datadog', employer: 'Datadog', careersUrl: 'https://careers.datadoghq.com/', industry: 'Technology & software', country: 'US', region: 'Global', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'mongodb', employer: 'MongoDB', careersUrl: 'https://www.mongodb.com/careers', industry: 'Technology & software', country: 'US', region: 'Global', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'elastic', employer: 'Elastic', careersUrl: 'https://www.elastic.co/careers', industry: 'Technology & software', country: 'US', region: 'Global', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'twilio', employer: 'Twilio', careersUrl: 'https://www.twilio.com/en-us/company/jobs', industry: 'Telecommunications', country: 'US', region: 'Global', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'intercom', employer: 'Intercom', careersUrl: 'https://www.intercom.com/careers', industry: 'Technology & customer service', country: 'IE', region: 'Europe', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'figma', employer: 'Figma', careersUrl: 'https://www.figma.com/careers/', industry: 'Technology & design', country: 'US', region: 'Global', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'instacart', employer: 'Instacart', careersUrl: 'https://instacart.careers/', industry: 'Retail & logistics', country: 'US', region: 'North America', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'dropbox', employer: 'Dropbox', careersUrl: 'https://jobs.dropbox.com/', industry: 'Technology & software', country: 'US', region: 'Global', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'pinterest', employer: 'Pinterest', careersUrl: 'https://www.pinterestcareers.com/', industry: 'Technology & media', country: 'US', region: 'North America', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'duolingo', employer: 'Duolingo', careersUrl: 'https://careers.duolingo.com/', industry: 'Education', country: 'US', region: 'Global', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'coursera', employer: 'Coursera', careersUrl: 'https://careers.coursera.com/', industry: 'Education', country: 'US', region: 'Global', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'khanacademy', employer: 'Khan Academy', careersUrl: 'https://www.khanacademy.org/careers', industry: 'Education', country: 'US', region: 'North America', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'd2l', employer: 'D2L', careersUrl: 'https://www.d2l.com/careers/', industry: 'Education', country: 'CA', region: 'North America', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'mozilla', employer: 'Mozilla', careersUrl: 'https://www.mozilla.org/en-US/careers/', industry: 'Nonprofit & technology', country: 'US', region: 'Global', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'wikimedia', employer: 'Wikimedia Foundation', careersUrl: 'https://wikimediafoundation.org/about/jobs/', industry: 'Nonprofit', country: 'US', region: 'Global', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'formlabs', employer: 'Formlabs', careersUrl: 'https://formlabs.com/careers/', industry: 'Manufacturing & engineering', country: 'US', region: 'Global', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'markforged', employer: 'Markforged', careersUrl: 'https://markforged.com/careers', industry: 'Manufacturing & engineering', country: 'US', region: 'Global', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'flexport', employer: 'Flexport', careersUrl: 'https://www.flexport.com/careers/', industry: 'Logistics & supply chain', country: 'US', region: 'Global', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'vonage', employer: 'Vonage', careersUrl: 'https://www.vonage.com/careers/', industry: 'Telecommunications', country: 'US', region: 'Global', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'bandwidth', employer: 'Bandwidth', careersUrl: 'https://www.bandwidth.com/careers/', industry: 'Telecommunications', country: 'US', region: 'North America', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'thoughtworks', employer: 'Thoughtworks', careersUrl: 'https://www.thoughtworks.com/careers', industry: 'Consulting & professional services', country: 'US', region: 'Global', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'brex', employer: 'Brex', careersUrl: 'https://www.brex.com/careers', industry: 'Financial services', country: 'US', region: 'North America', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'chime', employer: 'Chime', careersUrl: 'https://careers.chime.com/', industry: 'Financial services', country: 'US', region: 'North America', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'sofi', employer: 'SoFi', careersUrl: 'https://www.sofi.com/careers/', industry: 'Financial services', country: 'US', region: 'North America', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'affirm', employer: 'Affirm', careersUrl: 'https://www.affirm.com/careers', industry: 'Financial services', country: 'US', region: 'North America', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'monzo', employer: 'Monzo', careersUrl: 'https://monzo.com/careers', industry: 'Financial services', country: 'GB', region: 'Europe', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'betterment', employer: 'Betterment', careersUrl: 'https://www.betterment.com/careers', industry: 'Financial services', country: 'US', region: 'North America', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'oscar', employer: 'Oscar Health', careersUrl: 'https://www.hioscar.com/careers', industry: 'Healthcare', country: 'US', region: 'North America', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'flatironhealth', employer: 'Flatiron Health', careersUrl: 'https://flatiron.com/careers/', industry: 'Healthcare', country: 'US', region: 'North America', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'talkspace', employer: 'Talkspace', careersUrl: 'https://www.talkspace.com/careers', industry: 'Healthcare', country: 'US', region: 'North America', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'zocdoc', employer: 'Zocdoc', careersUrl: 'https://www.zocdoc.com/about/careers', industry: 'Healthcare', country: 'US', region: 'North America', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'doximity', employer: 'Doximity', careersUrl: 'https://www.doximity.com/careers', industry: 'Healthcare', country: 'US', region: 'North America', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'tripadvisor', employer: 'Tripadvisor', careersUrl: 'https://careers.tripadvisor.com/', industry: 'Hospitality & travel', country: 'US', region: 'Global', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'getyourguide', employer: 'GetYourGuide', careersUrl: 'https://www.getyourguide.careers/', industry: 'Hospitality & travel', country: 'DE', region: 'Europe', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'andurilindustries', employer: 'Anduril Industries', careersUrl: 'https://www.anduril.com/careers', industry: 'Defense & manufacturing', country: 'US', region: 'North America', descriptionMode: 'metadata' },
  { provider: 'greenhouse', token: 'relativity', employer: 'Relativity Space', careersUrl: 'https://www.relativityspace.com/careers', industry: 'Aerospace & manufacturing', country: 'US', region: 'North America', descriptionMode: 'metadata' },
  { provider: 'greenhouse', token: 'samsara', employer: 'Samsara', careersUrl: 'https://www.samsara.com/company/careers', industry: 'Logistics & IoT', country: 'US', region: 'Global', descriptionMode: 'metadata' },
  { provider: 'greenhouse', token: 'hellofresh', employer: 'HelloFresh', careersUrl: 'https://careers.hellofresh.com/', industry: 'Food & hospitality', country: 'DE', region: 'Global', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'trivago', employer: 'trivago', careersUrl: 'https://careers.trivago.com/', industry: 'Hospitality & travel', country: 'DE', region: 'Europe', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'contentful', employer: 'Contentful', careersUrl: 'https://www.contentful.com/careers/', industry: 'Technology & software', country: 'DE', region: 'Europe', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'typeform', employer: 'Typeform', careersUrl: 'https://www.typeform.com/careers/', industry: 'Technology & software', country: 'ES', region: 'Europe', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'tide', employer: 'Tide', careersUrl: 'https://www.tide.co/careers/', industry: 'Financial services', country: 'GB', region: 'Global', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'gocardless', employer: 'GoCardless', careersUrl: 'https://gocardless.com/careers/', industry: 'Financial services', country: 'GB', region: 'Europe', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'groww', employer: 'Groww', careersUrl: 'https://groww.in/careers', industry: 'Financial services', country: 'IN', region: 'Asia', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'moniepoint', employer: 'Moniepoint', careersUrl: 'https://moniepoint.com/careers', industry: 'Financial services', country: 'NG', region: 'Africa', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'cultureamp', employer: 'Culture Amp', careersUrl: 'https://www.cultureamp.com/company/careers', industry: 'HR & professional services', country: 'AU', region: 'Global', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'tamara', employer: 'Tamara', careersUrl: 'https://tamara.co/careers', industry: 'Financial services', country: 'SA', region: 'Middle East', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'xendit', employer: 'Xendit', careersUrl: 'https://www.xendit.co/en/careers/', industry: 'Financial services', country: 'ID', region: 'Asia', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'adyen', employer: 'Adyen', careersUrl: 'https://careers.adyen.com/', industry: 'Financial services', country: 'NL', region: 'Global', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'deliveroo', employer: 'Deliveroo', careersUrl: 'https://careers.deliveroo.co.uk/', industry: 'Delivery & hospitality', country: 'GB', region: 'Europe', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'lyft', employer: 'Lyft', careersUrl: 'https://www.lyft.com/careers', industry: 'Transport', country: 'US', region: 'North America', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'planradar', employer: 'PlanRadar', careersUrl: 'https://www.planradar.com/careers/', industry: 'Construction technology', country: 'AT', region: 'Europe', descriptionMode: 'full' },
  { provider: 'greenhouse', token: 'wildlifestudios', employer: 'Wildlife Studios', careersUrl: 'https://wildlifestudios.com/careers/', industry: 'Gaming & consumer', country: 'BR', region: 'South America', descriptionMode: 'full' },
  { provider: 'lever', token: 'spotify', employer: 'Spotify', careersUrl: 'https://www.lifeatspotify.com/', industry: 'Music & technology', country: 'SE', region: 'Global', descriptionMode: 'full' },
  { provider: 'lever', token: 'palantir', employer: 'Palantir', careersUrl: 'https://www.palantir.com/careers/', industry: 'Technology & data', country: 'US', region: 'Global', descriptionMode: 'full' },
  { provider: 'lever', token: 'cred', employer: 'CRED', careersUrl: 'https://careers.cred.club/', industry: 'Financial services', country: 'IN', region: 'India', descriptionMode: 'full' },
  { provider: 'ashby', token: 'ramp', employer: 'Ramp', careersUrl: 'https://ramp.com/careers', industry: 'Financial services', country: 'US', region: 'North America', descriptionMode: 'full' },
  { provider: 'ashby', token: 'linear', employer: 'Linear', careersUrl: 'https://linear.app/careers', industry: 'Technology & software', country: 'US', region: 'Global', descriptionMode: 'full' },
  { provider: 'ashby', token: 'notion', employer: 'Notion', careersUrl: 'https://www.notion.com/careers', industry: 'Technology & software', country: 'US', region: 'Global', descriptionMode: 'full' },
  { provider: 'ashby', token: 'supabase', employer: 'Supabase', careersUrl: 'https://supabase.com/careers', industry: 'Technology & software', country: 'US', region: 'Global', descriptionMode: 'full' },
  { provider: 'ashby', token: 'cursor', employer: 'Cursor', careersUrl: 'https://cursor.com/careers', industry: 'Technology & AI', country: 'US', region: 'Global', descriptionMode: 'full' },
  { provider: 'ashby', token: 'replit', employer: 'Replit', careersUrl: 'https://replit.com/careers', industry: 'Technology & software', country: 'US', region: 'Global', descriptionMode: 'full' },
  { provider: 'ashby', token: 'posthog', employer: 'PostHog', careersUrl: 'https://posthog.com/careers', industry: 'Technology & software', country: 'US', region: 'Global', descriptionMode: 'full' },
  { provider: 'ashby', token: 'n8n', employer: 'n8n', careersUrl: 'https://n8n.io/careers/', industry: 'Technology & software', country: 'DE', region: 'Europe', descriptionMode: 'full' },
  { provider: 'ashby', token: 'andela', employer: 'Andela', careersUrl: 'https://www.andela.com/careers/', industry: 'Professional services', country: 'US', region: 'Global', descriptionMode: 'full' },
  { provider: 'ashby', token: 'headway', employer: 'Headway', careersUrl: 'https://headway.co/careers', industry: 'Healthcare', country: 'US', region: 'North America', descriptionMode: 'full' },
  { provider: 'ashby', token: 'doctolib', employer: 'Doctolib', careersUrl: 'https://careers.doctolib.com/', industry: 'Healthcare', country: 'FR', region: 'Europe', descriptionMode: 'full' },
  { provider: 'ashby', token: 'formenergy', employer: 'Form Energy', careersUrl: 'https://www.formenergy.com/careers/', industry: 'Energy', country: 'US', region: 'North America', descriptionMode: 'full' },
  { provider: 'ashby', token: 'hopper', employer: 'Hopper', careersUrl: 'https://www.hopper.com/careers', industry: 'Hospitality & travel', country: 'CA', region: 'North America', descriptionMode: 'full' },
  { provider: 'ashby', token: 'kayak', employer: 'KAYAK', careersUrl: 'https://www.kayak.com/careers', industry: 'Hospitality & travel', country: 'US', region: 'Global', descriptionMode: 'full' },
  { provider: 'ashby', token: 'nubank', employer: 'Nubank', careersUrl: 'https://nubank.com.br/carreiras/', industry: 'Financial services', country: 'BR', region: 'Latin America', descriptionMode: 'full' },
  { provider: 'ashby', token: 'qonto', employer: 'Qonto', careersUrl: 'https://qonto.com/en/careers', industry: 'Financial services', country: 'FR', region: 'Europe', descriptionMode: 'full' },
  { provider: 'ashby', token: 'sonder', employer: 'Sonder', careersUrl: 'https://www.sonder.com/careers', industry: 'Hospitality', country: 'CA', region: 'North America', descriptionMode: 'full' },
];
