// Default hospital form field configurations
const defaultHospitalFormConfig = {
  sections: [
    {
      id: 'basic',
      title: 'Basic Information',
      fields: [
        {
          id: 'name',
          label: 'Hospital Name',
          type: 'text',
          required: true,
          validation: {
            minLength: 3,
            maxLength: 100,
            pattern: '^[\\w\\s\\-\']+$',
            message: 'Hospital name can only contain letters, numbers, spaces, hyphens, and apostrophes'
          }
        },
        {
          id: 'subdomain',
          label: 'Subdomain',
          type: 'text',
          required: true,
          validation: {
            pattern: '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$',
            maxLength: 63,
            message: 'Use only lowercase letters, numbers, and hyphens. Must start and end with alphanumeric.'
          }
        }
      ]
    },
    {
      id: 'contact',
      title: 'Contact Information',
      fields: [
        {
          id: 'contactInfo.phone',
          label: 'Phone Number',
          type: 'tel',
          required: true,
          validation: {
            pattern: '^\\+?[\\d\\s-]{10}$', // More strict length limits
            message: 'Enter a valid phone number (10 digits)'
          }
        },
        {
          id: 'contactInfo.website',
          label: 'Website',
          type: 'url',
          required: false,
          validation: {
            pattern: '^https?:\\/\\/[\\w\\-]+(\\.[\\w\\-]+)+[/#?]?.*$',
            message: 'Enter a valid website URL'
          }
        }
      ]
    },
    {
      id: 'address',
      title: 'Address',
      fields: [
        {
          id: 'address.street',
          label: 'Street Address',
          type: 'text',
          required: true,
          validation: {
            minLength: 5,
            maxLength: 200
          }
        },
        {
          id: 'address.city',
          label: 'City',
          type: 'text',
          required: true,
          validation: {
            pattern: '^[\\w\\s\\-\']+$',
            minLength: 2,
            maxLength: 100
          }
        },
        {
          id: 'address.district',
          label: 'District',
          type: 'text',
          required: true,
          validation: {
            pattern: '^[\\w\\s\\-\']+$',
            minLength: 2,
            maxLength: 100
          }
        },
        {
          id: 'address.state',
          label: 'State',
          type: 'text',
          required: true,
          validation: {
            pattern: '^[\\w\\s\\-\']+$',
            minLength: 2,
            maxLength: 100
          }
        },
        {
          id: 'address.pincode',
          label: 'PIN Code',
          type: 'text',
          required: true,
          validation: {
            pattern: '^[0-9]{6}$',
            message: 'Enter a valid 6-digit PIN code',
            transform: (value) => value.replace(/\\s/g, '') // Remove spaces
          }
        }
      ]
    },
    {
      id: 'additional',
      title: 'Additional Information',
      fields: [
        {
          id: 'gstin',
          label: 'GSTIN',
          type: 'text',
          required: true,
          validation: {
            pattern: '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$',
            message: 'Enter a valid GSTIN',
            transform: (value) => value.toUpperCase() // Auto-convert to uppercase
          }
        },
        {
          id: 'logo',
          label: 'Hospital Logo',
          type: 'file',
          required: false,
          validation: {
            acceptedTypes: ['image/jpeg', 'image/png', 'image/webp'],
            maxSize: 2 * 1024 * 1024, // 2MB
            message: 'Please upload a JPEG, PNG, or WebP image up to 2MB'
          }
        },
        {
          id: 'themeColor',
          label: 'Theme Color',
          type: 'color',
          required: false,
          defaultValue: '#2563EB',
          validation: {
            pattern: '^#[0-9A-Fa-f]{6}$',
            message: 'Please select a valid color'
          }
        },
        {
          id: 'establishedDate',
          label: 'Established Date',
          type: 'date',
          required: true,
          validation: {
            max: new Date().toISOString().split('T')[0], // Cannot be in the future
            message: 'Establishment date cannot be in the future'
          }
        }
      ]
    }
  ]
};

module.exports = defaultHospitalFormConfig;