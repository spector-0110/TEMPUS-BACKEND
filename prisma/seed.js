const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const subscriptionPlans = [
  {
    name: 'Basic',
    description: 'Perfect for small clinics getting started',
    maxDoctors: 2,
    monthlyPrice: 999,
    yearlyPrice: 10789,
    features: JSON.stringify([
      'Up to 2 doctors',
      'Basic appointment scheduling',
      'Basic patient records',
      'Email notifications',
      '100 SMS credits/month'
    ]),
    isActive: true
  },
  {
    name: 'Professional',
    description: 'Ideal for growing medical practices',
    maxDoctors: 5,
    monthlyPrice: 1999,
    yearlyPrice: 21589,
    features: JSON.stringify([
      'Up to 5 doctors',
      'Advanced appointment scheduling',
      'Complete patient records',
      'Email notifications',
      '500 SMS credits/month',
      'Analytics dashboard',
      'Priority support'
    ]),
    isActive: true
  },
  {
    name: 'Enterprise',
    description: 'Complete solution for large hospitals',
    maxDoctors: 15,
    monthlyPrice: 4999,
    yearlyPrice: 53989,
    features: JSON.stringify([
      'Up to 15 doctors',
      'Advanced appointment scheduling',
      'Complete patient records',
      'Unlimited email notifications',
      '2000 SMS credits/month',
      'Advanced analytics',
      '24/7 priority support',
      'Custom integrations',
      'Multi-branch support'
    ]),
    isActive: true
  }
];

async function main() {
  console.log('Start seeding subscription plans...');
  
  for (const plan of subscriptionPlans) {
    const existingPlan = await prisma.subscriptionPlan.findFirst({
      where: { name: plan.name }
    });

    if (!existingPlan) {
      await prisma.subscriptionPlan.create({
        data: plan
      });
      console.log(`Created subscription plan: ${plan.name}`);
    } else {
      await prisma.subscriptionPlan.update({
        where: { id: existingPlan.id },
        data: plan
      });
      console.log(`Updated subscription plan: ${plan.name}`);
    }
  }

  console.log('Seeding completed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });