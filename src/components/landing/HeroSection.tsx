import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, Play, Building2, Users, CreditCard } from "lucide-react";
import { useLandingSettings } from "@/hooks/useLandingSettings";
import heroImage from "@/assets/hero-landlord.png";

export function HeroSection() {
  const { trialDays } = useLandingSettings();

  return (
    <section className="relative min-h-screen flex items-center pt-16 overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-accent/5" />
      
      {/* Decorative elements */}
      <div className="absolute top-20 left-10 w-72 h-72 bg-primary/10 rounded-full blur-3xl" />
      <div className="absolute bottom-20 right-10 w-96 h-96 bg-accent/10 rounded-full blur-3xl" />
      
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left Content */}
          <div className="space-y-8">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium">
              <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
              Trusted by 100+ Property Managers in Kenya
            </div>
            
            {/* Headline */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight">
              Property Management{" "}
              <span className="text-primary">Made Simple</span>
            </h1>
            
            {/* Subheadline */}
            <p className="text-lg sm:text-xl text-muted-foreground max-w-lg">
              Streamline rent collection with M-Pesa integration, automate invoicing, 
              and manage tenants effortlessly. All in one powerful platform.
            </p>
            
            {/* Key benefits */}
            <div className="flex flex-col sm:flex-row gap-4">
              {[
                "Automated Rent Collection",
                "Real-time M-Pesa Payments",
                "Tenant Portal Included"
              ].map((benefit) => (
                <div key={benefit} className="flex items-center gap-2 text-foreground">
                  <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0" />
                  <span className="text-sm font-medium">{benefit}</span>
                </div>
              ))}
            </div>
            
            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-4">
              <Link to="/auth">
                <Button size="lg" className="w-full sm:w-auto bg-accent text-accent-foreground hover:bg-accent/90 text-lg px-8 py-6">
                  Start Free {trialDays}-Day Trial
                  <ArrowRight className="ml-2 w-5 h-5" />
                </Button>
              </Link>
              <Button size="lg" variant="outline" className="w-full sm:w-auto text-lg px-8 py-6">
                <Play className="mr-2 w-5 h-5" />
                Watch Demo
              </Button>
            </div>
            
            {/* Trust text */}
            <p className="text-sm text-muted-foreground">
              No credit card required • Cancel anytime • Free setup assistance
            </p>
          </div>
          
          {/* Right Content - Hero Image & Stats Cards */}
          <div className="relative lg:pl-8">
            {/* Hero Image */}
            <div className="mb-6 rounded-2xl overflow-hidden shadow-2xl border border-border">
              <img 
                src={heroImage} 
                alt="Happy landlord managing properties on tablet" 
                className="w-full h-auto object-cover"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              {/* Stats Card 1 */}
              <div className="bg-card rounded-2xl p-6 shadow-lg border border-border">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                  <Building2 className="w-6 h-6 text-primary" />
                </div>
                <div className="text-3xl font-bold text-foreground">500+</div>
                <div className="text-sm text-muted-foreground">Properties Managed</div>
              </div>
              
              {/* Stats Card 2 */}
              <div className="bg-card rounded-2xl p-6 shadow-lg border border-border">
                <div className="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center mb-4">
                  <Users className="w-6 h-6 text-success" />
                </div>
                <div className="text-3xl font-bold text-foreground">10,000+</div>
                <div className="text-sm text-muted-foreground">Happy Tenants</div>
              </div>
              
              {/* Stats Card 3 */}
              <div className="bg-card rounded-2xl p-6 shadow-lg border border-border">
                <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mb-4">
                  <CreditCard className="w-6 h-6 text-accent" />
                </div>
                <div className="text-3xl font-bold text-foreground">KES 150M+</div>
                <div className="text-sm text-muted-foreground">Rent Collected</div>
              </div>
              
              {/* Stats Card 4 - Floating review */}
              <div className="bg-primary rounded-2xl p-6 shadow-lg">
                <div className="flex gap-1 mb-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <svg key={star} className="w-4 h-4 text-warning fill-current" viewBox="0 0 20 20">
                      <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z" />
                    </svg>
                  ))}
                </div>
                <p className="text-primary-foreground text-sm italic mb-3">
                  "Zira Homes reduced my rent collection time by 80%!"
                </p>
                <div className="text-primary-foreground/80 text-xs">
                  — James K., Property Manager
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
