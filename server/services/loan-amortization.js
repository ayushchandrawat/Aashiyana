
// Sicherheitskappe: 50 Jahre. Verhindert Endlosschleifen bei Eingaben, deren Rate

export const MAX_LOAN_MONTHS = 600;

const round2 = (v) => Math.round(v * 100) / 100;

export function computeLoanSchedule({
  principal,
  fixedRate,
  initialRepaymentRate,
  interestMode,
  fixedPeriodMonths = null,
  followupRate = null,
}) {
  const P = Number(principal);
  const rf = Number(fixedRate);
  const rt = Number(initialRepaymentRate);


  const variable = interestMode === 'fixed_then_variable';
  const rv = variable ? Number(followupRate) : rf;
  const bindingMonths = variable && Number.isFinite(Number(fixedPeriodMonths))
    ? Number(fixedPeriodMonths)
    : null;


  const monthly = round2((P * (rf + rt)) / 100 / 12);

  let balance = P;
  let totalInterest = 0;
  let remainingAfterBinding = 0;
  const schedule = [];

  for (let n = 1; n <= MAX_LOAN_MONTHS && balance > 0.005; n++) {
    const inFixed = !bindingMonths || n <= bindingMonths;
    const rate = inFixed ? rf : rv;
    const interest = balance * (rate / 100 / 12);
    let principalPart = monthly - interest;

    if (principalPart <= 0) return { ok: false, reason: 'not_amortizing' };
    if (principalPart > balance) principalPart = balance; // letzte (Teil-)Rate

    balance -= principalPart;
    totalInterest += interest;
    schedule.push({
      n,
      rate,
      interest: round2(interest),
      principal: round2(principalPart),
      balance: round2(Math.max(0, balance)),
      phase: inFixed ? 1 : 2,
    });
    if (bindingMonths && n === bindingMonths) remainingAfterBinding = round2(Math.max(0, balance));
  }

  if (balance > 0.005) return { ok: false, reason: 'too_long' };

  return {
    ok: true,
    monthlyPayment: monthly,
    totalMonths: schedule.length,
    totalInterest: round2(totalInterest),
    totalRepayment: round2(P + totalInterest),
    remainingAfterBinding,
    schedule,
  };
}

export function remainingPrincipalAfter(schedule, principal, paidInstallments) {
  const paid = Math.floor(Number(paidInstallments) || 0);
  if (paid <= 0) return round2(Number(principal) || 0);

  if (paid >= schedule.length) return 0;
  return schedule[paid - 1].balance;
}

export function remainingPrincipalFromPayments({
  principal,
  fixedRate,
  interestMode,
  fixedPeriodMonths = null,
  followupRate = null,
}, payments) {
  const rf = Number(fixedRate);
  const variable = interestMode === 'fixed_then_variable';
  const rv = variable ? Number(followupRate) : rf;
  const bindingMonths = variable && Number.isFinite(Number(fixedPeriodMonths))
    ? Number(fixedPeriodMonths)
    : null;
  const rateFor = (n) => ((!bindingMonths || n <= bindingMonths) ? rf : rv);

  const rows = (Array.isArray(payments) ? payments : [])
    .map((p) => ({ n: Math.floor(Number(p?.installment_number) || 0), amount: Number(p?.amount) || 0 }))
    .filter((p) => p.n > 0 && p.amount > 0)
    .sort((a, b) => a.n - b.n);

  let balance = Number(principal) || 0;
  let prevN = 0;
  for (const { n, amount } of rows) {


    if (balance <= 0.005) { balance = 0; break; }
    // Ausgelassene Perioden zahlen nichts, verzinsen aber - gekappt bei

    for (let k = prevN + 1; k < n && k <= MAX_LOAN_MONTHS; k++) {
      balance += balance * (rateFor(k) / 100 / 12);
    }
    const interest = balance * (rateFor(n) / 100 / 12);
    balance -= (amount - interest);
    prevN = n;
  }
  return round2(Math.max(0, balance));
}

export function remainingInstallmentsForBalance({
  balance,
  monthlyPayment,
  fixedRate,
  interestMode,
  fixedPeriodMonths = null,
  followupRate = null,
  paidInstallments = 0,
}) {
  let rest = Number(balance);
  if (!Number.isFinite(rest) || rest <= 0.005) return 0;

  const zahlung = Number(monthlyPayment);
  if (!Number.isFinite(zahlung) || zahlung <= 0) return null;

  const rf = Number(fixedRate) || 0;
  const variabel = interestMode === 'fixed_then_variable';
  const rv = variabel ? (Number(followupRate) || 0) : rf;
  const bindung = variabel && Number.isFinite(Number(fixedPeriodMonths))
    ? Number(fixedPeriodMonths)
    : null;

  let raten = 0;

  // Schleife nicht ewig laufen lassen.
  for (let n = Number(paidInstallments) + 1; n <= MAX_LOAN_MONTHS && rest > 0.005; n++) {
    const satz = (!bindung || n <= bindung) ? rf : rv;
    const zins = rest * (satz / 100 / 12);
    const tilgung = zahlung - zins;





    if (tilgung <= 0) return null;
    rest -= Math.min(tilgung, rest);
    raten += 1;
  }
  return rest > 0.005 ? null : raten;
}

