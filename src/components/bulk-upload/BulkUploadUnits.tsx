import React from "react";
import { BulkUploadBase, ValidationError } from "./BulkUploadBase";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function BulkUploadUnits() {
  const { user } = useAuth();

  const templateData = [
    {
      "Unit Number": "A101",
      "Property Name": "Sunrise Apartments",
      "Unit Type": "1BR",
      "Monthly Rent": "25000",
      "Security Deposit": "50000", 
      "Garbage Deposit": "1000",
      "Floor": "1",
      "Square Feet": "650",
      "Bedrooms": "1",
      "Bathrooms": "1",
      "Amenities": "Balcony,Parking",
      "Description": "Modern 1-bedroom apartment with city view"
    },
    {
      "Unit Number": "B202",
      "Property Name": "Sunset Complex",
      "Unit Type": "2BR", 
      "Monthly Rent": "35000",
      "Security Deposit": "70000",
      "Garbage Deposit": "1500",
      "Floor": "2",
      "Square Feet": "850",
      "Bedrooms": "2",
      "Bathrooms": "2",
      "Amenities": "Balcony,Parking,Storage",
      "Description": "Spacious 2-bedroom unit with modern fixtures"
    }
  ];

  const requiredFields = ["Unit Number", "Property Name", "Unit Type", "Monthly Rent"];

  const validateData = async (data: Array<Record<string, any>>): Promise<ValidationError[]> => {
    const errors: ValidationError[] = [];
    const unitNumbers = new Set<string>();

    // Get available properties for the current user
    let availableProperties: Array<{name: string, id: string}> = [];
    try {
      let query = supabase
        .from("properties")
        .select("id, name");

      // If not admin, filter by user's properties
      const { data: userRoles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user?.id);

      const isAdmin = userRoles?.some(role => role.role === "Admin");
      
      if (!isAdmin) {
        query = query.eq("owner_id", user?.id);
      }

      const { data: properties } = await query;
      if (properties) {
        availableProperties = properties;
      }
    } catch (error) {
      console.error("Error fetching available properties:", error);
    }

    // Check existing unit numbers
    const existingUnitNumbers = new Set<string>();
    try {
      const { data: units } = await supabase
        .from("units")
        .select("unit_number");
      
      if (units) {
        units.forEach(unit => existingUnitNumbers.add(unit.unit_number.toLowerCase()));
      }
    } catch (error) {
      console.error("Error fetching existing unit numbers:", error);
    }

    data.forEach((row, index) => {
      // Check required fields
      requiredFields.forEach(field => {
        if (!row[field] || String(row[field]).trim() === '') {
          errors.push({
            row: index,
            field,
            message: `${field} is required`
          });
        }
      });

      // Validate unit number uniqueness
      if (row["Unit Number"]) {
        const unitNumber = String(row["Unit Number"]).toLowerCase().trim();
        
        // Check for duplicates in current upload
        if (unitNumbers.has(unitNumber)) {
          errors.push({
            row: index,
            field: "Unit Number",
            message: "Duplicate unit number in upload"
          });
        } else {
          unitNumbers.add(unitNumber);
        }

        // Check against existing database unit numbers
        if (existingUnitNumbers.has(unitNumber)) {
          errors.push({
            row: index,
            field: "Unit Number",
            message: "Unit number already exists"
          });
        }
      }

      // Validate property exists and is accessible
      if (row["Property Name"]) {
        const propertyName = String(row["Property Name"]).trim();
        const property = availableProperties.find(p => 
          p.name.toLowerCase() === propertyName.toLowerCase()
        );
        
        if (!property) {
          errors.push({
            row: index,
            field: "Property Name",
            message: "Property not found or not accessible to you"
          });
        }
      }

      // Validate monthly rent is a positive number
      if (row["Monthly Rent"]) {
        const rent = Number(row["Monthly Rent"]);
        if (isNaN(rent) || rent <= 0) {
          errors.push({
            row: index,
            field: "Monthly Rent",
            message: "Monthly rent must be a positive number"
          });
        }
      }

      // Validate security deposit is a non-negative number
      if (row["Security Deposit"]) {
        const deposit = Number(row["Security Deposit"]);
        if (isNaN(deposit) || deposit < 0) {
          errors.push({
            row: index,
            field: "Security Deposit",
            message: "Security deposit must be a non-negative number"
          });
        }
      }

      // Validate garbage deposit is a non-negative number
      if (row["Garbage Deposit"]) {
        const deposit = Number(row["Garbage Deposit"]);
        if (isNaN(deposit) || deposit < 0) {
          errors.push({
            row: index,
            field: "Garbage Deposit",
            message: "Garbage deposit must be a non-negative number"
          });
        }
      }

      // Validate numeric fields
      const numericFields = ["Floor", "Square Feet", "Bedrooms", "Bathrooms"];
      numericFields.forEach(field => {
        if (row[field] && row[field] !== '') {
          const value = Number(row[field]);
          if (isNaN(value) || value < 0) {
            errors.push({
              row: index,
              field,
              message: `${field} must be a non-negative number`
            });
          }
        }
      });
    });

    return errors;
  };

  const importData = async (data: Array<Record<string, any>>): Promise<void> => {
    try {
      // Get property IDs from names
      const propertyNames = data.map(row => String(row["Property Name"]).trim());
      const { data: properties, error: propertiesError } = await supabase
        .from("properties")
        .select("id, name")
        .in("name", propertyNames);

      if (propertiesError) {
        throw new Error(`Failed to fetch properties: ${propertiesError.message}`);
      }

      const propertyMap = new Map(
        properties?.map(property => [property.name.toLowerCase(), property.id]) || []
      );

      // Create units
      const units = data.map(row => ({
        unit_number: String(row["Unit Number"]).trim(),
        property_id: propertyMap.get(String(row["Property Name"]).trim().toLowerCase()),
        unit_type: String(row["Unit Type"]).trim(),
        rent_amount: Number(row["Monthly Rent"]),
        security_deposit: row["Security Deposit"] ? Number(row["Security Deposit"]) : null,
        garbage_deposit: row["Garbage Deposit"] ? Number(row["Garbage Deposit"]) : null,
        floor_number: row["Floor"] ? Number(row["Floor"]) : null,
        square_feet: row["Square Feet"] ? Number(row["Square Feet"]) : null,
        bedrooms: row["Bedrooms"] ? Number(row["Bedrooms"]) : null,
        bathrooms: row["Bathrooms"] ? Number(row["Bathrooms"]) : null,
        amenities: row["Amenities"] ? String(row["Amenities"]).split(',').map(a => a.trim()) : null,
        description: row["Description"] ? String(row["Description"]) : null,
        status: 'vacant'
      }));

      const { error: unitsError } = await supabase
        .from("units")
        .insert(units);

      if (unitsError) {
        throw new Error(`Failed to create units: ${unitsError.message}`);
      }

    } catch (error) {
      console.error("Import error:", error);
      throw error;
    }
  };

  return (
    <BulkUploadBase
      title="Bulk Upload Units"
      description="Upload multiple unit records at once. Units will be linked to existing properties and set as available for rent."
      templateData={templateData}
      templateFileName="unit_upload_template.xlsx"
      requiredFields={requiredFields}
      onValidateData={validateData}
      onImportData={importData}
      maxRecords={2000}
    />
  );
}