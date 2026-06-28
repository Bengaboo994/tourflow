const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
  } catch (err) {
    console.log('Webhook signature error:', err.message);
    return { statusCode: 400, body: 'Webhook Error: ' + err.message };
  }

  const SUPA_URL = 'https://dhcqbdyrbviormfsdcyr.supabase.co';
  const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  async function updateProfile(email, status) {
    const res = await fetch(SUPA_URL + '/rest/v1/profiles?email=eq.' + encodeURIComponent(email), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPA_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPA_SERVICE_KEY,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ subscription_status: status })
    });
    console.log('Profile update status:', res.status, 'email:', email, 'status:', status);
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const email = session.customer_email || (session.customer_details && session.customer_details.email);
    if (email) await updateProfile(email, 'active');
  }

  if (stripeEvent.type === 'customer.subscription.deleted') {
    const subscription = stripeEvent.data.object;
    const customerId = subscription.customer;
    // Get customer email from Stripe
    const customer = await stripe.customers.retrieve(customerId);
    if (customer && customer.email) await updateProfile(customer.email, 'canceled');
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
